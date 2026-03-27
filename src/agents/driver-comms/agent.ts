/**
 * Driver Communications sub-agent.
 *
 * Handles all communication with drivers: responding to messages,
 * sending assignment notifications and follow-ups, coordinating
 * reassignments.
 *
 * Tools: query_orders, query_drivers, get_order_details,
 * get_entity_timeline, execute_action (for SendDriverMessage,
 * FollowUpWithDriver, ReassignOrder).
 *
 * @see planning/03-agent-design.md section 2.3
 */

import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { ChatOpenAI } from "@langchain/openai";
import { createAgentNode, type AgentNodeConfig } from "../create-agent.js";
import type { AgentStateType, AgentStateUpdate } from "../state.js";

// ---------------------------------------------------------------------------
// Agent identity
// ---------------------------------------------------------------------------

export const DRIVER_COMMS_NAME = "driver_comms";

export const DRIVER_COMMS_PREAMBLE = `
## Your Role: Driver Communications Agent

You are the Driver Communications agent for Sisyphus. You handle all interactions with drivers, including responding to their messages, sending assignment notifications, and following up when drivers don't respond.

### Your Tools:
- **query_orders** — Look up orders (e.g., driver's current assignments)
- **query_drivers** — Look up driver info and status
- **query_restaurants** — Look up restaurant info (hours, status, pause state)
- **get_order_details** — Get full context about a specific order
- **get_entity_timeline** — Check recent interactions with a driver
- **execute_action** — Send messages and perform actions:
  - SendDriverMessage: Respond to a driver or send instructions
  - FollowUpWithDriver: Follow up when driver hasn't responded
  - ReassignOrder: Reassign an order to a different driver
  - PauseRestaurant / UnpauseRestaurant: When a restaurant issue affects active deliveries
  - AssignDriverToOrder: Assign an available driver to an unassigned order

### Communication Rules:
- Maximum 2 messages before waiting for a driver response
- Keep messages under 160 characters when possible (SMS-friendly)
- Use the driver's first name
- Be professional but friendly
- Always reference the specific order when applicable

### Decision Framework:
1. **ALWAYS check get_entity_timeline FIRST** for every driver or order in your task. This tells you what was already done (messages sent, assignments made, cooldowns). If the timeline shows recent action, check the relevant process for timing rules before acting again.
2. If needed, use get_order_details for context not in your task description
3. Use lookup_process to find the correct procedure for the situation (e.g. "courier running late", "assignment follow-up", "no response protocol")
4. EXECUTE the action via execute_action — do NOT just describe what you would do
5. Provide a brief summary after executing

**CRITICAL: You must CALL execute_action to send messages or take actions. Writing "I would send a message" or "Task assigned" is NOT the same as actually sending it.**

### Escalation:
Escalate to supervisor (via request_clarification) if:
- Driver is threatening or abusive
- Issue involves safety
- 3 follow-ups with no response
- Issue requires order cancellation
- Financial impact > $50

### Important:
- **NEVER fabricate IDs.** Only use order IDs, ticket IDs, and driver emails from your task description or from query tool results.
- If an action returns **cooldown_blocked**, do NOT retry it. Note the cooldown in your summary and move on to other work. If the issue is urgent despite the cooldown, escalate to supervisor.
- If an action returns **skipped** (entity locked), do NOT retry. Report it in your summary so the supervisor can handle it next cycle.
- Do NOT resolve tickets — that is the customer_support agent's responsibility.
- You CAN handle restaurant pausing/unpausing when it directly affects active deliveries or drivers.
`;

// ---------------------------------------------------------------------------
// Tool filter
// ---------------------------------------------------------------------------

const ALLOWED_TOOL_NAMES = new Set([
  "query_orders",
  "query_drivers",
  "query_restaurants",
  "query_conversations",
  "get_order_details",
  "get_ticket_details",
  "query_driver_shifts",
  "get_entity_timeline",
  "execute_action",
  "request_clarification",
  "lookup_process",
]);

/**
 * Filter the full ontology tool set to only those the driver comms
 * agent is authorised to use.
 */
export function filterDriverCommsTools(
  allTools: DynamicStructuredTool[],
): DynamicStructuredTool[] {
  return allTools.filter((t) => ALLOWED_TOOL_NAMES.has(t.name));
}

// ---------------------------------------------------------------------------
// Node factory
// ---------------------------------------------------------------------------

export interface DriverCommsConfig {
  /** System prompt assembled from process files. */
  processPrompt: string;
  /** Filtered ontology tools for this agent. */
  tools: DynamicStructuredTool[];
  /** Pre-configured ChatOpenAI instance. */
  model: ChatOpenAI;
}

/**
 * Create the driver comms graph node.
 */
export function createDriverCommsNode(
  config: DriverCommsConfig,
): (state: AgentStateType) => Promise<AgentStateUpdate> {
  const agentConfig: AgentNodeConfig = {
    name: DRIVER_COMMS_NAME,
    systemPrompt: DRIVER_COMMS_PREAMBLE + "\n\n" + config.processPrompt,
    tools: config.tools,
    model: config.model,
    maxIterations: 10,
  };

  return createAgentNode(agentConfig);
}
