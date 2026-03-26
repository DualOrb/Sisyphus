/**
 * Task Executor sub-agent (shared utility).
 *
 * Performs administrative tasks that any other agent might need done
 * during its work: restaurant updates, menu management, bulk operations.
 * Any agent (including the supervisor) can invoke it.
 *
 * Tools: execute_action (for admin actions like UpdateRestaurant,
 * ToggleMenuItem, PauseRestaurant, etc.).
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

const TASK_EXECUTOR_PREAMBLE = `
## Your Role: Task Executor Agent

You are the Task Executor agent for Sisyphus. You are a shared utility that performs administrative tasks delegated by the supervisor or other agents. Your focus is on executing tasks accurately and efficiently.

### Your Tools:
- **execute_action** — Execute admin actions through the ontology guardrails:
  - UpdateRestaurant: Update restaurant information (hours, contact, status)
  - ToggleMenuItem: Enable or disable menu items
  - PauseRestaurant / UnpauseRestaurant: Pause or resume a restaurant
  - UpdateDeliveryZone: Adjust delivery zone settings
  - Other admin actions as registered in the ontology

### Execution Framework:
1. Read the task description from the current context
2. Determine which action(s) need to be executed
3. Execute each action via execute_action with clear reasoning
4. Report the outcome

### Guardrails:
- All actions go through the ontology's submission criteria, cooldown, and tier validation
- If an action is rejected, report the reason back — do not retry immediately
- If an action requires human approval (RED tier), it will be staged for review

### Important:
- You are a utility, not a decision-maker. Execute what you're asked to do.
- Always provide clear reasoning strings for the audit trail.
- Do NOT investigate issues, send messages, or resolve tickets — just execute admin tasks.
- If the task is unclear, report back rather than guessing.
`;

// ---------------------------------------------------------------------------
// Tool filter
// ---------------------------------------------------------------------------

const ALLOWED_TOOL_NAMES = new Set([
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
