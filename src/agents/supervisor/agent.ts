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
  "task_executor",
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

/**
 * Schema for a single task assignment within the `assign_tasks` tool.
 */
const taskAssignmentSchema = z.object({
  agent: z
    .string()
    .describe("The sub-agent name. MUST be exactly one of: driver_comms, customer_support, task_executor"),
  task: z
    .string()
    .describe("Detailed description of the task, including all relevant IDs, names, and context."),
  taskType: z
    .string()
    .describe("Task category. One of: monitoring, messaging, ticket_resolution, complex_reasoning, escalation_decision"),
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

### ABSOLUTE RULES — NEVER VIOLATE THESE
1. **YOU are the monitor.** You receive the full dispatch board every cycle. You watch for issues. Sub-agents only get dispatched when there is a SPECIFIC ACTION to take (send a message, assign a driver, resolve a ticket). NEVER delegate "monitor", "check on", "watch", or "confirm status" tasks — that is YOUR job. If an order is approaching ready time, YOU will see it in the next cycle's data.
2. **NEVER message a driver whose status is En-Route, At-Restaurant, In-Bag, or InTransit.** These drivers are ACTIVELY WORKING. Do NOT create a task for them. This applies even if the order seems late.
3. **ONE DRIVER = ONE TASK.** If a driver has multiple orders, create ONE task that mentions ALL their orders. NEVER create separate tasks for the same driver email — parallel agents WILL send duplicate messages.
4. **customer_support handles EXISTING UNASSIGNED TICKETS ONLY.** Only assign to customer_support when the prompt lists an open ticket under "-- Open Tickets --" with status [New] or [Pending] and owner Unassigned. Include the ticket's issueId in the task description. NEVER assign customer_support to "investigate" orders, "create" tickets, or "monitor" anything.
5. **NEVER assign empty or vague tasks.** Every task must describe a specific action. "No tasks" is not a task — use an empty array [] instead.

You manage these sub-agents: ${agentMembersStr}.

**YOUR ONLY JOB IS ROUTING.** You are a dispatcher, not an investigator. The prompt already contains all current orders, drivers, markets, and tickets. DO NOT call query tools to re-read data that is already in your prompt.

On your VERY FIRST response, call "assign_tasks" immediately. Identify ALL issues from the prompt and delegate them in a SINGLE call.

### PARALLEL DISPATCH
You can (and should) assign MULTIPLE tasks at once. If you see 3 issues, create 3 task entries in a single "assign_tasks" call. They will execute in parallel.

- If there are issues to address → call assign_tasks with one entry per issue
- If everything looks stable → call assign_tasks with an empty array []

### DO NOT FLAG THESE (they are NORMAL):
- Driver going off-shift with **0 active orders** — normal end of shift
- Orders assigned to off-shift drivers with ready times **hours in the future** — pre-scheduled evening assignments, not emergencies
- A driver finishing their last delivery after going off-shift — normal behavior

### WHEN TO MESSAGE A DRIVER:
- Order is 5+ minutes past ready time AND driver has NOT confirmed (no DeliveryConfirmed) AND is NOT en-route/at-restaurant → message to check status
- Driver went offline WITH active orders that are due soon (within 30 min) → message to confirm
- DO NOT message a driver about an order that has already been reassigned away from them

**DO NOT** call query_orders, query_drivers, query_tickets, or get_order_details. The data is already in your prompt. Just read it and route.

The ONLY tools you should use are:
- "assign_tasks" — to delegate work to sub-agents (this is your primary tool)
- "execute_action" — ONLY for urgent actions you must take directly (rare)
- "request_clarification" — ONLY for situations you genuinely cannot handle

### Agent Responsibilities:
- **driver_comms** — ACTIONS only: send a message to a driver, follow up on an unanswered message, reassign an order, assign an unassigned order to a driver. Only dispatch when you have a specific action to take — never to "check on" or "monitor" a driver
- **customer_support** — Resolve EXISTING UNASSIGNED TICKETS only. Assign ONLY when the prompt shows an open ticket (issueId listed under "-- Open Tickets --"). Include the issueId in your task. Never assign for order investigation, late delivery monitoring, or ticket creation
- **task_executor** — General-purpose action execution: order status updates, order cancellations, ticket notes/escalations, flagging market issues, and restaurant lookups (query_restaurants). NOTE: restaurant admin actions (pause/unpause, menu toggles, hours adjustments, delivery zone updates) are NOT yet registered — do NOT assign those tasks to task_executor as they will fail with "Unknown action". For restaurant operational issues that need manual intervention, escalate to a human operator instead

### TASK DESCRIPTION REQUIREMENTS
When routing, you MUST include ALL of the following in your task description:
- **Driver email addresses** (e.g. "Driver SJS (sukhkalsi65561@gmail.com)") — agents use email as driverId, NOT monikers
- **Order IDs** — use the 8-char OrderIdKey (e.g. "dfee7605"). Copy them from the dispatch data above. The dispatch data lists order IDs next to each driver — USE THEM
- **Current status** and **ready time**
- **Restaurant name** and **delivery address**
- **What action you think is needed** — be specific ("send a check-in message", "investigate and resolve ticket 7645aca1")

If you do NOT have a driver's email address in the prompt, tell the sub-agent to call query_drivers to look it up FIRST before attempting any action.

### CRITICAL: NEVER FABRICATE IDs
Every order ID, ticket ID, and driver email you pass to a sub-agent MUST be copied verbatim from the dispatch data above. If you write "1 active order" without the OrderIdKey, the sub-agent WILL fail. If you cannot find the specific ID, tell the sub-agent to query for it.

### MARKET HEALTH IS YOUR JOB
You already receive the full dispatch board, driver counts, order counts, and focus areas every cycle. Do NOT delegate "check market health" or "monitor staffing" to any sub-agent. If you see a market issue (low drivers, high ETAs, surge), either:
- Flag it yourself via execute_action(FlagMarketIssue) if it needs recording
- Include it in your cycle summary for the next cycle
- Escalate to a human if it needs manual intervention

### RECENT ACTIONS — CHECK BEFORE DISPATCHING
The prompt includes a RECENT ACTIONS section showing everything the AI has done recently.
- Before assigning driver_comms: check if the driver was already messaged about the same issue. If messaged <5 min ago, do NOT re-message — wait for the follow-up timer.
- If an entity shows 3+ failed attempts for the same action, consider escalating instead of retrying.
- Check PENDING FOLLOW-UPS — if a follow-up is due or overdue, dispatch driver_comms for that specific follow-up.
- If the RECENT ACTIONS section is empty, this is a fresh start — act normally.
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
        const validTasks = (args.tasks ?? []).filter((t) =>
          (AGENT_NAMES as readonly string[]).includes(t.agent),
        );
        // Deduplicate — LLMs sometimes emit the same task twice
        const seen = new Set<string>();
        const deduped = validTasks.filter((t) => {
          const key = `${t.agent}:${t.task.slice(0, 200)}`;
          if (seen.has(key)) {
            log.info({ agent: t.agent, task: t.task.slice(0, 60) }, "Deduped duplicate task");
            return false;
          }
          seen.add(key);
          return true;
        });

        // ----------------------------------------------------------------
        // Code-level enforcement of routing rules the LLM ignores
        // ----------------------------------------------------------------
        pendingTasks = deduped.filter((t) => {
          const taskLower = t.task.toLowerCase();

          // RULE: customer_support ONLY handles existing tickets with a real issueId
          if (t.agent === "customer_support") {
            // Task must reference a ticket ID (8-char hex) in a ticket context
            const hasTicketRef = /\b[a-f0-9]{8}\b/.test(t.task) &&
              (taskLower.includes("ticket") || taskLower.includes("issueid") || taskLower.includes("issue id"));
            if (!hasTicketRef) {
              log.info({ agent: t.agent, task: t.task.slice(0, 80) }, "Dropped: customer_support assigned without ticket reference");
              return false;
            }
          }

          // RULE: No monitoring/check-on tasks for ANY agent
          {
            const isMonitoring = taskLower.includes("monitor ") || taskLower.includes("monitoring") ||
              taskLower.startsWith("check on ") || taskLower.startsWith("check the status") ||
              taskLower.includes("confirm status") || taskLower.includes("watch for") ||
              taskLower.includes("market health");
            // Allow if the task also contains a concrete action verb
            const hasAction = taskLower.includes("send ") || taskLower.includes("message ") ||
              taskLower.includes("assign ") || taskLower.includes("reassign") ||
              taskLower.includes("resolve ") || taskLower.includes("follow up") ||
              taskLower.includes("escalat");
            if (isMonitoring && !hasAction) {
              log.info({ agent: t.agent, task: t.task.slice(0, 80) }, "Dropped: monitoring task (supervisor's job)");
              return false;
            }
          }

          // RULE: No empty or "no tasks" assignments
          if (t.task.trim().length < 10 || taskLower === "no tasks") {
            log.info({ agent: t.agent, task: t.task.slice(0, 80) }, "Dropped: empty/vague task");
            return false;
          }

          return true;
        });
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
