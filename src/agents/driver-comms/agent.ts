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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DynamicStructuredTool } from "@langchain/core/tools";

// ---------------------------------------------------------------------------
// Agent identity
// ---------------------------------------------------------------------------

export const DRIVER_COMMS_NAME = "driver_comms";

export const DRIVER_COMMS_PREAMBLE = readFileSync(
  resolve(new URL(".", import.meta.url).pathname, "role.md"),
  "utf-8",
);

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

