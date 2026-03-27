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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DynamicStructuredTool } from "@langchain/core/tools";

// ---------------------------------------------------------------------------
// Agent identity
// ---------------------------------------------------------------------------

export const CUSTOMER_SUPPORT_NAME = "customer_support";

export const CUSTOMER_SUPPORT_PREAMBLE = readFileSync(
  resolve(new URL(".", import.meta.url).pathname, "role.md"),
  "utf-8",
);

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

