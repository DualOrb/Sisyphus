/**
 * Barrel export for the Sisyphus agent hierarchy.
 *
 * @example
 * ```ts
 * import { createDispatchGraph, AgentState } from "./agents/index.js";
 *
 * const graph = await createDispatchGraph(store, redis, "./processes");
 * const result = await graph.invoke(
 *   { messages: [new HumanMessage("Check market health")] },
 *   { configurable: { thread_id: "shift-001" } },
 * );
 * ```
 */

// State definition
export { AgentState, type AgentStateType, type AgentStateUpdate, type TaskAssignment } from "./state.js";

// LLM factory
export { createChatModel } from "./llm-factory.js";

// Agent node factory
export { createAgentNode, type AgentNodeConfig } from "./create-agent.js";

// Supervisor
export {
  createSupervisorNode,
  AGENT_NAMES,
  assignTasksTool,
  type AgentName,
  type SupervisorConfig,
} from "./supervisor/agent.js";

// Sub-agents — names, preambles, and tool filters
export { filterDriverCommsTools, DRIVER_COMMS_NAME, DRIVER_COMMS_PREAMBLE } from "./driver-comms/agent.js";
export { filterCustomerSupportTools, CUSTOMER_SUPPORT_NAME, CUSTOMER_SUPPORT_PREAMBLE } from "./customer-support/agent.js";
export { filterTaskExecutorTools, TASK_EXECUTOR_NAME, TASK_EXECUTOR_PREAMBLE } from "./task-executor/agent.js";

// Graph
export {
  createDispatchGraph,
  type CreateDispatchGraphOptions,
} from "./graph.js";
