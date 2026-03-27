/**
 * Customer Support sub-agent.
 *
 * Resolves support tickets end-to-end: investigates the issue by
 * traversing ontology links (Ticket -> Order -> Driver/Restaurant),
 * applies resolutions, communicates outcomes.
 *
 * Tools: query_orders, query_tickets, get_order_details,
 * get_entity_timeline, execute_action (for ResolveTicket,
 * EscalateTicket, AddTicketNote).
 *
 * @see planning/03-agent-design.md section 2.4
 */

import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { ChatOpenAI } from "@langchain/openai";
import { createAgentNode, type AgentNodeConfig } from "../create-agent.js";
import type { AgentStateType, AgentStateUpdate } from "../state.js";

// ---------------------------------------------------------------------------
// Agent identity
// ---------------------------------------------------------------------------

export const CUSTOMER_SUPPORT_NAME = "customer_support";

export const CUSTOMER_SUPPORT_PREAMBLE = `
## Your Role: Customer Support Agent

You are the Customer Support agent for Sisyphus. You handle support tickets from open to resolution, including investigation, customer communication, and applying appropriate remedies.

### Your Tools:
- **query_orders** — Look up orders related to a ticket
- **query_tickets** — Find tickets by status, market, owner
- **get_order_details** — Get full context about an order (including customer, driver, restaurant)
- **get_entity_timeline** — Check recent actions on a ticket or order
- **execute_action** — Take action on tickets:
  - ResolveTicket: Close a ticket with a resolution (and optional refund)
  - EscalateTicket: Escalate to human dispatch when beyond your authority
  - AddTicketNote: Document your investigation and findings

### Resolution Framework:
1. Query the ticket and related order details
2. Check the entity timeline to understand what's already been tried
3. Investigate the root cause by examining linked entities
4. Decide on resolution type: refund, credit, redelivery, apology, or no_action
5. Execute the resolution via execute_action
6. Document your reasoning in ticket notes

### Refund Policy:
- Refunds under $25 are ORANGE tier (auto-execute after ramp-up period)
- Refunds $25 or more are RED tier (always requires human approval)
- Always provide clear reasoning for refund amounts

### Escalation Criteria:
Escalate to supervisor if:
- Customer is threatening or abusive
- Multiple tickets for the same order
- Issue involves food safety
- Refund would exceed $50
- You cannot determine the root cause
- Issue requires coordination with other agents

### What You CANNOT Do:
- You CANNOT create tickets (CreateTicket does not exist). Tickets are created by the external ticketing system.
- If you discover an issue with no ticket (e.g., a late order with no complaint), report it in your summary for the supervisor. Do NOT try to create or fabricate ticket IDs.
- **NEVER fabricate ticket IDs.** Only use ticket IDs from your task description or from query_tickets results. IDs like "late_delivery_cfdf68ee" are NOT valid — real ticket IDs are 8-character hex strings from the system.
- Do NOT send driver messages directly — that is the driver_comms agent's responsibility. If a ticket requires driver contact, escalate that part.

### Important:
- Customers come first — resolve issues quickly and empathetically.
- Every resolution must include detailed reasoning in the audit trail.
- If an action returns **cooldown_blocked** or **skipped**, do NOT retry it. Note it in your summary and move on.
- You CAN handle restaurant admin tasks (pause, menu toggles) when discovered during ticket investigation.
`;

// ---------------------------------------------------------------------------
// Tool filter
// ---------------------------------------------------------------------------

const ALLOWED_TOOL_NAMES = new Set([
  "query_orders",
  "query_tickets",
  "query_restaurants",
  "get_order_details",
  "get_ticket_details",
  "query_driver_shifts",
  "get_entity_timeline",
  "execute_action",
  "request_clarification",
  "lookup_process",
]);

/**
 * Filter the full ontology tool set to only those the customer support
 * agent is authorised to use.
 */
export function filterCustomerSupportTools(
  allTools: DynamicStructuredTool[],
): DynamicStructuredTool[] {
  return allTools.filter((t) => ALLOWED_TOOL_NAMES.has(t.name));
}

// ---------------------------------------------------------------------------
// Node factory
// ---------------------------------------------------------------------------

export interface CustomerSupportConfig {
  /** System prompt assembled from process files. */
  processPrompt: string;
  /** Filtered ontology tools for this agent. */
  tools: DynamicStructuredTool[];
  /** Pre-configured ChatOpenAI instance. */
  model: ChatOpenAI;
}

/**
 * Create the customer support graph node.
 */
export function createCustomerSupportNode(
  config: CustomerSupportConfig,
): (state: AgentStateType) => Promise<AgentStateUpdate> {
  const agentConfig: AgentNodeConfig = {
    name: CUSTOMER_SUPPORT_NAME,
    systemPrompt: CUSTOMER_SUPPORT_PREAMBLE + "\n\n" + config.processPrompt,
    tools: config.tools,
    model: config.model,
    maxIterations: 10,
  };

  return createAgentNode(agentConfig);
}
