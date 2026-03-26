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
  routeDecisionTool,
  type AgentName,
  type SupervisorConfig,
} from "./supervisor/agent.js";

// Sub-agents
export {
  createDriverCommsNode,
  filterDriverCommsTools,
  DRIVER_COMMS_NAME,
  type DriverCommsConfig,
} from "./driver-comms/agent.js";

export {
  createCustomerSupportNode,
  filterCustomerSupportTools,
  CUSTOMER_SUPPORT_NAME,
  type CustomerSupportConfig,
} from "./customer-support/agent.js";

// Graph
export {
  createDispatchGraph,
  type CreateDispatchGraphOptions,
} from "./graph.js";
