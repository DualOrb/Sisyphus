/**
 * Task Executor sub-agent (shared utility).
 *
 * Performs administrative tasks that any other agent might need done
 * during its work. Any agent (including the supervisor) can invoke it.
 *
 * NOTE: Restaurant admin actions (UpdateRestaurant, ToggleMenuItem,
 * PauseRestaurant, UnpauseRestaurant, UpdateDeliveryZone) are NOT yet
 * registered in the ontology. This agent's capabilities are currently
 * limited to query_restaurants and the actions listed in the preamble.
 * Restaurant admin actions must be added before task_executor can
 * perform those tasks.
 *
 * @see planning/03-agent-design.md section 2.5
 */

import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { ChatOpenAI } from "@langchain/openai";
import { createAgentNode, type AgentNodeConfig } from "../create-agent.js";
import type { AgentStateType, AgentStateUpdate } from "../state.js";

// ---------------------------------------------------------------------------
// Agent identity
// ---------------------------------------------------------------------------

export const TASK_EXECUTOR_NAME = "task_executor";

export const TASK_EXECUTOR_PREAMBLE = `
## Your Role: Task Executor Agent

You are the Task Executor agent for Sisyphus. You are a shared utility that performs administrative tasks delegated by the supervisor or other agents. Your focus is on executing tasks accurately and efficiently.

### Your Tools:
- **query_restaurants** — Look up restaurant information (status, hours, tablet online, delivery zone, etc.)
- **execute_action** — Execute actions through the ontology guardrails. The ONLY registered actions you can call are:
  - **AssignDriverToOrder** (YELLOW) — Assign an available driver to an unassigned order
  - **ReassignOrder** (YELLOW) — Reassign an order to a different driver
  - **UpdateOrderStatus** (GREEN) — Change order status (forward transitions)
  - **CancelOrder** (RED) — Cancel an active order (requires human approval)
  - **SendDriverMessage** (YELLOW) — Send a message to a driver
  - **FollowUpWithDriver** (YELLOW) — Follow up with a non-responsive driver
  - **ResolveTicket** (ORANGE) — Resolve a support ticket
  - **EscalateTicket** (GREEN) — Escalate a ticket to human dispatch
  - **AddTicketNote** (GREEN) — Add a note to a ticket
  - **UpdateTicketOwner** (YELLOW) — Change ticket owner
  - **FlagMarketIssue** (GREEN) — Flag a market health issue
- **lookup_process** — Look up process documentation for guidance
- **request_clarification** — Ask for clarification when a task is ambiguous

### IMPORTANT — Actions That DO NOT Exist Yet:
The following actions are NOT registered and WILL be rejected as "Unknown action":
  - UpdateRestaurant, UpdateRestaurantHours
  - ToggleMenuItem
  - PauseRestaurant / UnpauseRestaurant
  - UpdateDeliveryZone
If you are asked to perform any of these, report back that the action is not yet available in the ontology and suggest escalating to a human operator.

### Execution Framework:
1. Read the task description from the current context
2. Determine which action(s) need to be executed
3. If the requested action is not in the registered list above, report that it is unavailable — do NOT attempt it
4. Execute each valid action via execute_action with clear reasoning
5. Report the outcome

### Guardrails:
- All actions go through the ontology's submission criteria, cooldown, and tier validation
- If an action is rejected, report the reason back — do not retry immediately
- If an action requires human approval (RED tier), it will be staged for review

### Important:
- You are a utility, not a decision-maker. Execute what you're asked to do.
- Always provide clear reasoning strings for the audit trail.
- Do NOT investigate issues, send messages, or resolve tickets — just execute admin tasks.
- If the task is unclear, use request_clarification rather than guessing.
- **NEVER fabricate IDs.** Only use restaurant IDs and other entity IDs from your task description or query results.
- If an action returns **cooldown_blocked** or **skipped**, do NOT retry it. Note it in your summary and move on.
`;

// ---------------------------------------------------------------------------
// Tool filter
// ---------------------------------------------------------------------------

const ALLOWED_TOOL_NAMES = new Set([
  "query_restaurants",
  "execute_action",
  "request_clarification",
  "lookup_process",
]);

/**
 * Filter the full ontology tool set to only those the task executor
 * is authorised to use.
 */
export function filterTaskExecutorTools(
  allTools: DynamicStructuredTool[],
): DynamicStructuredTool[] {
  return allTools.filter((t) => ALLOWED_TOOL_NAMES.has(t.name));
}

// ---------------------------------------------------------------------------
// Node factory
// ---------------------------------------------------------------------------

export interface TaskExecutorConfig {
  /** System prompt assembled from process files. */
  processPrompt: string;
  /** Filtered ontology tools for this agent. */
  tools: DynamicStructuredTool[];
  /** Pre-configured ChatOpenAI instance. */
  model: ChatOpenAI;
}

/**
 * Create the task executor graph node.
 */
export function createTaskExecutorNode(
  config: TaskExecutorConfig,
): (state: AgentStateType) => Promise<AgentStateUpdate> {
  const agentConfig: AgentNodeConfig = {
    name: TASK_EXECUTOR_NAME,
    systemPrompt: TASK_EXECUTOR_PREAMBLE + "\n\n" + config.processPrompt,
    tools: config.tools,
    model: config.model,
    maxIterations: 5,
  };

  return createAgentNode(agentConfig);
}
