/**
 * Supervisor agent — the central dispatcher.
 *
 * The supervisor triages incoming events, decides which sub-agent
 * should handle the next piece of work, and monitors sub-agent
 * progress. It uses a structured tool call to express its routing
 * decision so the graph can branch deterministically.
 *
 * @see planning/03-agent-design.md section 2.1
 */

import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, AIMessage, type BaseMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { AgentStateType, AgentStateUpdate } from "../state.js";
import { createChildLogger } from "../../lib/index.js";

const log = createChildLogger("supervisor");

// ---------------------------------------------------------------------------
// The routing tool — this is how the supervisor expresses its decision
// ---------------------------------------------------------------------------

/** Valid sub-agent names the supervisor can delegate to. */
export const AGENT_NAMES = [
  "market_monitor",
  "driver_comms",
  "customer_support",
  "task_executor",
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

/**
 * A pseudo-tool the supervisor calls to indicate which agent should act
 * next (or "__end__" to finish). The tool itself does nothing — the
 * graph reads the tool call arguments to determine routing.
 */
export const routeDecisionTool = new DynamicStructuredTool({
  name: "route_to_agent",
  description:
    "Decide which sub-agent should handle the next task, or finish. " +
    "Call this tool with the chosen agent and a brief description of " +
    "the task being delegated.",
  schema: z.object({
    next: z
      .enum([...AGENT_NAMES, "__end__"])
      .describe(
        "The sub-agent to delegate to, or '__end__' if all tasks are complete.",
      ),
    task: z
      .string()
      .describe("Brief description of the task being delegated to the sub-agent."),
    taskType: z
      .enum([
        "monitoring",
        "messaging",
        "ticket_resolution",
        "complex_reasoning",
        "escalation_decision",
      ])
      .nullable().optional()
      .describe("Task category for model routing (optional)."),
  }),
  func: async (input) => {
    // This tool is never actually executed for its result — its arguments
    // are read by the graph routing logic. We return a confirmation string
    // so the message history stays coherent.
    return JSON.stringify({
      routed_to: input.next,
      task: input.task,
    });
  },
});

// ---------------------------------------------------------------------------
// Supervisor node factory
// ---------------------------------------------------------------------------

export interface SupervisorConfig {
  /** System prompt (AGENTS.md + supervisor process files). */
  systemPrompt: string;
  /** Ontology tools the supervisor can use directly. */
  ontologyTools: DynamicStructuredTool[];
  /** Pre-configured ChatOpenAI instance. */
  model: ChatOpenAI;
}

/**
 * Create the supervisor node function.
 *
 * The supervisor:
 *   1. Receives the full state (messages, escalation flags, etc.)
 *   2. Calls the LLM with its system prompt, ontology tools, and the
 *      routing tool
 *   3. The LLM either calls ontology tools (for investigation) or
 *      calls `route_to_agent` to delegate
 *   4. Returns updated state with `nextAgent` set for graph routing
 */
export function createSupervisorNode(
  config: SupervisorConfig,
): (state: AgentStateType) => Promise<AgentStateUpdate> {
  const { systemPrompt, ontologyTools, model } = config;

  // The supervisor gets ontology tools PLUS the routing decision tool
  const allTools = [...ontologyTools, routeDecisionTool];
  const modelWithTools = model.bindTools(allTools);

  const agentMembersStr = AGENT_NAMES.join(", ");

  const routingInstructions = `

## Routing

You manage the following sub-agents: ${agentMembersStr}.

After analyzing the current situation, you MUST call the "route_to_agent" tool to indicate which sub-agent should act next. If all current tasks are handled and there is nothing urgent, route to "__end__".

You may use ontology tools (query_orders, query_drivers, query_tickets, get_order_details, get_entity_timeline, execute_action, request_clarification) to gather information before making your routing decision. But you MUST eventually call "route_to_agent" to indicate your decision.

### Agent Responsibilities:
- **market_monitor** — Market health, driver/order ratios, proactive alerts, zone monitoring
- **driver_comms** — Driver messaging, assignment follow-ups, driver issues, reassignments
- **customer_support** — Support tickets, refunds, customer communication, escalations
- **task_executor** — Admin tasks: restaurant updates, menu changes, bulk operations
`;

  return async (state: AgentStateType): Promise<AgentStateUpdate> => {
    log.info("Supervisor invoked");

    // If a sub-agent flagged escalation, include that context
    let escalationContext = "";
    if (state.needsEscalation && state.escalationReason) {
      escalationContext = `\n\n## ESCALATION ALERT\nA sub-agent has requested escalation: ${state.escalationReason}\nPlease review and decide on the appropriate next step.\n`;
    }

    const fullPrompt = systemPrompt + routingInstructions + escalationContext;
    const systemMsg = new SystemMessage(fullPrompt);

    const inputMessages: BaseMessage[] = [systemMsg, ...state.messages];
    const newMessages: BaseMessage[] = [];

    let nextAgent = "";
    let currentTask = state.currentTask;
    let currentTaskType = state.currentTaskType;
    let currentMessages = inputMessages;

    // Allow the supervisor a few iterations to investigate before routing
    const maxIterations = 5;

    for (let i = 0; i < maxIterations; i++) {
      // Debug: log what we're sending to the LLM
      log.info({
        iteration: i,
        messageCount: currentMessages.length,
        messageTypes: currentMessages.map((m) => `${m.constructor.name}${(m as any).tool_calls?.length ? `(${(m as any).tool_calls.length} tool_calls)` : ""}`),
      }, "Supervisor calling LLM");

      const response = await modelWithTools.invoke(currentMessages);
      newMessages.push(response);

      const aiMsg = response as AIMessage;
      const toolCalls = aiMsg.tool_calls ?? [];

      if (toolCalls.length === 0) {
        // LLM responded with text but no tool call — treat as done
        log.warn("Supervisor responded without calling route_to_agent — defaulting to __end__");
        nextAgent = "__end__";
        break;
      }

      // Check if any tool call is the routing decision
      const routeCall = toolCalls.find((tc) => tc.name === "route_to_agent");

      if (routeCall) {
        const args = routeCall.args as {
          next: string;
          task: string;
          taskType?: string;
        };
        nextAgent = args.next;
        currentTask = args.task;
        currentTaskType = args.taskType ?? "";

        log.info(
          { nextAgent, task: currentTask, taskType: currentTaskType },
          "Supervisor routing decision",
        );

        // Create synthetic tool responses for ALL tool calls in this message
        // (not just route_to_agent). Providers like Anthropic/Vertex require
        // every tool_use to have a matching tool_result.
        const { ToolMessage } = await import("@langchain/core/messages");
        for (const tc of toolCalls) {
          if (tc.name === "route_to_agent") {
            newMessages.push(new ToolMessage({
              content: JSON.stringify({ routed_to: nextAgent, task: currentTask }),
              tool_call_id: tc.id ?? "route",
              name: "route_to_agent",
            }));
          } else {
            // Provide a stub response for any non-routing tool calls
            // that were made alongside the routing decision
            newMessages.push(new ToolMessage({
              content: JSON.stringify({ status: "skipped", reason: "routing decision made" }),
              tool_call_id: tc.id ?? tc.name,
              name: tc.name,
            }));
          }
        }
        break;
      }

      // The supervisor called ontology tools — execute them
      // Build a mini tool-call execution for non-routing tools
      const nonRouteToolCalls = toolCalls.filter(
        (tc) => tc.name !== "route_to_agent",
      );

      if (nonRouteToolCalls.length > 0) {
        // Execute each tool call and create matching ToolMessages
        const { ToolMessage } = await import("@langchain/core/messages");
        const toolResponses: BaseMessage[] = [];

        for (const tc of toolCalls) {
          const tool = allTools.find((t) => t.name === tc.name);
          if (tool) {
            try {
              const result = await (tool as any).invoke(tc.args);
              toolResponses.push(new ToolMessage({
                content: typeof result === "string" ? result : JSON.stringify(result),
                tool_call_id: tc.id ?? tc.name,
                name: tc.name,
              }));
            } catch (err: any) {
              toolResponses.push(new ToolMessage({
                content: JSON.stringify({ error: err.message ?? "Tool execution failed" }),
                tool_call_id: tc.id ?? tc.name,
                name: tc.name,
              }));
            }
          } else {
            toolResponses.push(new ToolMessage({
              content: JSON.stringify({ error: `Unknown tool: ${tc.name}` }),
              tool_call_id: tc.id ?? tc.name,
              name: tc.name,
            }));
          }
        }

        newMessages.push(...toolResponses);
        currentMessages = [...currentMessages, response, ...toolResponses];
      }
    }

    // If we never got a routing decision, default to __end__
    if (!nextAgent) {
      log.warn("Supervisor exhausted iterations without routing — ending");
      nextAgent = "__end__";
    }

    return {
      messages: newMessages,
      nextAgent,
      currentTask,
      currentTaskType,
      // Clear escalation flags after supervisor has handled them
      needsEscalation: false,
      escalationReason: "",
    };
  };
}
