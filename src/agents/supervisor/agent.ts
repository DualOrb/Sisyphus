/**
 * Supervisor agent — the central dispatcher.
 *
 * The supervisor triages incoming events, decides which sub-agents
 * should handle work, and can dispatch MULTIPLE sub-agents in parallel.
 * It uses a structured tool call (`assign_tasks`) to express its routing
 * decisions so the graph can branch deterministically via `Send`.
 *
 * @see planning/03-agent-design.md section 2.1
 */

import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, AIMessage, type BaseMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { AgentStateType, AgentStateUpdate } from "../state.js";
import type { TaskAssignment } from "../state.js";
import { createChildLogger } from "../../lib/index.js";

const log = createChildLogger("supervisor");

// ---------------------------------------------------------------------------
// The routing tool — this is how the supervisor expresses its decisions
// ---------------------------------------------------------------------------

/** Valid sub-agent names the supervisor can delegate to. */
export const AGENT_NAMES = [
  "driver_comms",
  "customer_support",
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

/**
 * Schema for a single task assignment within the `assign_tasks` tool.
 */
const taskAssignmentSchema = z.object({
  agent: z
    .enum([...AGENT_NAMES])
    .describe("The sub-agent to delegate this task to."),
  task: z
    .string()
    .describe("Detailed description of the task, including all relevant IDs, names, and context."),
  taskType: z
    .enum([
      "monitoring",
      "messaging",
      "ticket_resolution",
      "complex_reasoning",
      "escalation_decision",
    ])
    .describe("Task category for model routing."),
});

/**
 * A tool the supervisor calls to assign tasks to one or more sub-agents
 * simultaneously. An empty `tasks` array signals that no work is needed
 * (equivalent to routing to __end__).
 *
 * The tool itself does nothing — the graph reads the tool call arguments
 * to determine routing via Send objects for parallel dispatch.
 */
export const assignTasksTool = new DynamicStructuredTool({
  name: "assign_tasks",
  description:
    "Assign one or more tasks to sub-agents for parallel execution. " +
    "Each task specifies the target agent, a detailed task description, and a task type. " +
    "Multiple tasks will run simultaneously. Pass an empty array if all issues are resolved.",
  schema: z.object({
    tasks: z
      .array(taskAssignmentSchema)
      .describe(
        "Array of task assignments. Each entry dispatches a sub-agent in parallel. " +
        "Pass an empty array [] if no work is needed (equivalent to finishing).",
      ),
  }),
  func: async (input) => {
    // This tool is never actually executed for its result — its arguments
    // are read by the graph routing logic. We return a confirmation string
    // so the message history stays coherent.
    return JSON.stringify({
      dispatched: input.tasks.length,
      agents: input.tasks.map((t) => t.agent),
    });
  },
});

/**
 * Backward-compatible export: the old `routeDecisionTool` is replaced by
 * `assignTasksTool`, but we re-export under both names so existing barrel
 * imports don't break.
 */
export const routeDecisionTool = assignTasksTool;

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
  /** Optional callback for full activity visibility. */
  onActivity?: import("../create-agent.js").AgentActivityCallback;
}

/**
 * Create the supervisor node function.
 *
 * The supervisor:
 *   1. Receives the full state (messages, escalation flags, etc.)
 *   2. Calls the LLM with its system prompt, ontology tools, and the
 *      assign_tasks tool
 *   3. The LLM either calls ontology tools (for investigation) or
 *      calls `assign_tasks` to delegate one or more tasks in parallel
 *   4. Returns updated state with `pendingTasks` set for graph routing
 */
export function createSupervisorNode(
  config: SupervisorConfig,
): (state: AgentStateType) => Promise<AgentStateUpdate> {
  const { systemPrompt, ontologyTools, model, onActivity } = config;

  // The supervisor gets ontology tools PLUS the task assignment tool
  const allTools = [...ontologyTools, assignTasksTool];
  const modelWithTools = model.bindTools(allTools);

  const agentMembersStr = AGENT_NAMES.join(", ");

  const routingInstructions = `

## Routing

You manage these sub-agents: ${agentMembersStr}.

**YOUR ONLY JOB IS ROUTING.** You are a dispatcher, not an investigator. The prompt already contains all current orders, drivers, markets, and tickets. DO NOT call query tools to re-read data that is already in your prompt.

On your VERY FIRST response, call "assign_tasks" immediately. Identify ALL issues from the prompt and delegate them in a SINGLE call.

### PARALLEL DISPATCH
You can (and should) assign MULTIPLE tasks at once. If you see 3 issues, create 3 task entries in a single "assign_tasks" call. They will execute in parallel.

- If there are issues to address → call assign_tasks with one entry per issue
- If everything looks stable → call assign_tasks with an empty array []

**DO NOT** call query_orders, query_drivers, query_tickets, or get_order_details. The data is already in your prompt. Just read it and route.

The ONLY tools you should use are:
- "assign_tasks" — to delegate work to sub-agents (this is your primary tool)
- "execute_action" — ONLY for urgent actions you must take directly (rare)
- "request_clarification" — ONLY for situations you genuinely cannot handle

### Agent Responsibilities:
- **driver_comms** — Message drivers, check on offline/late drivers, assignment issues, driver coverage gaps, restaurant pausing when it affects active deliveries
- **customer_support** — Support tickets, refunds, customer communication, restaurant issues reported via tickets, menu/admin issues discovered during ticket investigation

### TASK DESCRIPTION REQUIREMENTS
When routing, you MUST include ALL of the following in your task description:
- **Driver email addresses** (e.g. "Driver SJS (sukhkalsi65561@gmail.com)") — agents use email as driverId, NOT monikers
- **Order IDs** (short form e.g. "dfee7605")
- **Current status** and **ready time**
- **Restaurant name** and **delivery address**
- **What action you think is needed** — be specific ("send a check-in message", "investigate and resolve ticket")

If you do NOT have a driver's email address in the prompt, tell the sub-agent to call query_drivers to look it up FIRST before attempting any action. Example: "Driver DIK in PortElgin — email not available in prompt, use query_drivers({dispatchZone: 'PortElgin'}) to find their email before assigning."
`;

  return async (state: AgentStateType): Promise<AgentStateUpdate> => {
    log.info("Supervisor invoked");

    // If a sub-agent flagged escalation, include that context
    let escalationContext = "";
    if (state.needsEscalation && state.escalationReason) {
      escalationContext =
        `\n\n## ⚠️ ESCALATION ALERT — ACTION REQUIRED\n` +
        `A sub-agent has escalated the following issue to you:\n\n` +
        `> ${state.escalationReason}\n\n` +
        `You MUST address this escalation. Either:\n` +
        `1. Assign a sub-agent to handle the escalated issue (include the full context above in the task description)\n` +
        `2. If the issue cannot be handled by a sub-agent, acknowledge it in your response\n\n` +
        `Do NOT ignore this escalation or route to __end__ without addressing it.\n`;
    }

    const fullPrompt = systemPrompt + routingInstructions + escalationContext;
    const systemMsg = new SystemMessage(fullPrompt);

    // ---- Trim message history for re-invocations ----
    // After parallel sub-agents complete, the merged message history can be
    // huge (dozens of tool calls/results from multiple agents). The supervisor
    // only needs the dispatch context + a summary of what happened.
    // Keep: first HumanMessage (dispatch context) + last HumanMessage (bridge
    // summary). Drop the intermediate tool call noise.
    let trimmedMessages = state.messages;
    if (state.messages.length > 8) {
      const firstHuman = state.messages.find(
        (m) => m.constructor.name === "HumanMessage",
      );
      // Extract sub-agent final text responses (AIMessages without tool_calls)
      const agentSummaries = state.messages.filter(
        (m) => {
          if (m.constructor.name !== "AIMessage") return false;
          const ai = m as AIMessage;
          const hasCalls = ai.tool_calls && ai.tool_calls.length > 0;
          const hasContent = typeof ai.content === "string" && ai.content.length > 20;
          return !hasCalls && hasContent;
        },
      );
      const lastHuman = [...state.messages]
        .reverse()
        .find((m) => m.constructor.name === "HumanMessage");

      // Build a compact summary of sub-agent results
      const summaryTexts = agentSummaries
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .filter((t) => t.length > 0);

      const { HumanMessage: HM } = await import("@langchain/core/messages");
      const summaryMsg = summaryTexts.length > 0
        ? new HM(
            `## Sub-agent Results\n\n${summaryTexts.join("\n\n---\n\n")}\n\n---\n\n` +
            (lastHuman && typeof lastHuman.content === "string" ? lastHuman.content : "Review and decide next steps."),
          )
        : lastHuman ?? new HM("Review the current state and decide next steps.");

      trimmedMessages = [
        ...(firstHuman ? [firstHuman] : []),
        summaryMsg,
      ];
      log.info(
        { original: state.messages.length, trimmed: trimmedMessages.length },
        "Trimmed message history for supervisor re-invocation",
      );
    }

    const inputMessages: BaseMessage[] = [systemMsg, ...trimmedMessages];
    const newMessages: BaseMessage[] = [];

    let pendingTasks: TaskAssignment[] = [];
    let decided = false;
    let currentMessages = inputMessages;

    const maxIterations = 10;

    for (let i = 0; i < maxIterations; i++) {
      // After 3+ iterations without routing, nudge the LLM to make a decision
      if (i >= 3) {
        const nudge = new SystemMessage(
          `[SYSTEM] You have used ${i} investigation rounds without making a routing decision. ` +
          `You MUST call "assign_tasks" NOW to either delegate to sub-agents or pass an empty array to finish. ` +
          `Do not call any more ontology tools — make your routing decision immediately.`,
        );
        currentMessages = [...currentMessages, nudge];
      }

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
        log.warn("Supervisor responded without calling assign_tasks — defaulting to no tasks (end)");
        decided = true;
        break;
      }

      // Check if any tool call is the task assignment decision
      const assignCall = toolCalls.find((tc) => tc.name === "assign_tasks");

      if (assignCall) {
        const args = assignCall.args as { tasks: TaskAssignment[] };
        pendingTasks = (args.tasks ?? []).filter((t) =>
          (AGENT_NAMES as readonly string[]).includes(t.agent),
        );
        decided = true;

        log.info(
          {
            taskCount: pendingTasks.length,
            agents: pendingTasks.map((t) => t.agent),
          },
          "Supervisor routing decision (parallel dispatch)",
        );

        // Log full task details for visibility
        for (const t of pendingTasks) {
          onActivity?.({
            agent: "supervisor",
            type: "tool_call",
            iteration: i,
            content: `ASSIGN → ${t.agent} [${t.taskType}]: ${t.task}`,
          });
        }
        if (pendingTasks.length === 0) {
          onActivity?.({
            agent: "supervisor",
            type: "response",
            iteration: i,
            content: "No tasks to assign — routing to __end__",
          });
        }

        // Create synthetic tool responses for ALL tool calls in this message
        // (not just assign_tasks). Providers like Anthropic/Vertex require
        // every tool_use to have a matching tool_result.
        const { ToolMessage } = await import("@langchain/core/messages");
        for (const tc of toolCalls) {
          if (tc.name === "assign_tasks") {
            newMessages.push(new ToolMessage({
              content: JSON.stringify({
                dispatched: pendingTasks.length,
                agents: pendingTasks.map((t) => t.agent),
              }),
              tool_call_id: tc.id ?? "assign",
              name: "assign_tasks",
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
      const nonAssignToolCalls = toolCalls.filter(
        (tc) => tc.name !== "assign_tasks",
      );

      if (nonAssignToolCalls.length > 0) {
        // Execute each tool call and create matching ToolMessages
        const { ToolMessage } = await import("@langchain/core/messages");
        const toolResponses: BaseMessage[] = [];

        for (const tc of toolCalls) {
          const argsStr = JSON.stringify(tc.args);
          onActivity?.({ agent: "supervisor", type: "tool_call", iteration: i, content: `${tc.name}(${argsStr})` });

          const tool = allTools.find((t) => t.name === tc.name);
          if (tool) {
            try {
              const result = await (tool as any).invoke(tc.args);
              const content = typeof result === "string" ? result : JSON.stringify(result);
              onActivity?.({ agent: "supervisor", type: "tool_result", iteration: i, content: `${tc.name} → ${content}` });
              toolResponses.push(new ToolMessage({
                content,
                tool_call_id: tc.id ?? tc.name,
                name: tc.name,
              }));
            } catch (err: any) {
              const errContent = JSON.stringify({ error: err.message ?? "Tool execution failed" });
              onActivity?.({ agent: "supervisor", type: "tool_result", iteration: i, content: `${tc.name} → ERROR: ${err.message}` });
              toolResponses.push(new ToolMessage({
                content: errContent,
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

    // If we never got a routing decision, default to no tasks (end)
    if (!decided) {
      log.warn("Supervisor exhausted iterations without routing — ending");
    }

    // Backward compatibility: set nextAgent based on pendingTasks
    // If exactly one task, set nextAgent for any code that still reads it.
    // Otherwise clear it (parallel dispatch uses pendingTasks).
    const nextAgent =
      pendingTasks.length === 1
        ? pendingTasks[0].agent
        : pendingTasks.length === 0
          ? "__end__"
          : "";

    return {
      messages: newMessages,
      nextAgent,
      pendingTasks,
      currentTask: pendingTasks.length === 1 ? pendingTasks[0].task : "",
      currentTaskType: pendingTasks.length === 1 ? pendingTasks[0].taskType : "",
      // Clear escalation flags after supervisor has handled them
      needsEscalation: false,
      escalationReason: "",
    };
  };
}
