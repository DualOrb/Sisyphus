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

const DRIVER_COMMS_PREAMBLE = `
## Your Role: Driver Communications Agent

You are the Driver Communications agent for Sisyphus. You handle all interactions with drivers, including responding to their messages, sending assignment notifications, and following up when drivers don't respond.

### Your Tools:
- **query_orders** — Look up orders (e.g., driver's current assignments)
- **query_drivers** — Look up driver info and status
- **get_order_details** — Get full context about a specific order
- **get_entity_timeline** — Check recent interactions with a driver
- **execute_action** — Send messages and perform actions:
  - SendDriverMessage: Respond to a driver or send instructions
  - FollowUpWithDriver: Follow up when driver hasn't responded
  - ReassignOrder: Reassign an order to a different driver

### Communication Rules:
- Maximum 2 messages before waiting for a driver response
- Keep messages under 160 characters when possible (SMS-friendly)
- Use the driver's first name
- Be professional but friendly
- Always reference the specific order when applicable

### Decision Framework:
1. Use get_entity_timeline to understand what's already happened
2. Use get_order_details to understand the context
3. Decide on the appropriate action
4. Execute via execute_action with clear reasoning

### Escalation:
Escalate to supervisor (via request_clarification) if:
- Driver is threatening or abusive
- Issue involves safety
- 3 follow-ups with no response
- Issue requires order cancellation
- Financial impact > $50

### Important:
- Cooldowns are enforced by the ontology layer. If an action is blocked, respect the cooldown.
- Do NOT resolve tickets or update market alerts — those are other agents' responsibilities.
`;

// ---------------------------------------------------------------------------
// Tool filter
// ---------------------------------------------------------------------------

const ALLOWED_TOOL_NAMES = new Set([
  "query_orders",
  "query_drivers",
  "get_order_details",
  "get_entity_timeline",
  "execute_action",
  "request_clarification",
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
