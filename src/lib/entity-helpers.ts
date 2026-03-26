/**
 * Utility helpers for inferring entity type and ID from action names/params.
 *
 * Extracted into a standalone module to avoid circular dependencies between
 * the graph module and ontology-tools.
 */

/**
 * Infer entity type from an action name (e.g. "AssignDriverToOrder" -> "order").
 */
export function guessEntityType(actionType: string): string {
  if (actionType.includes("Order") || actionType.includes("Assign") || actionType.includes("Reassign"))
    return "order";
  if (actionType.includes("Driver") || actionType.includes("FollowUp"))
    return "driver";
  if (actionType.includes("Ticket") || actionType.includes("Escalate"))
    return "ticket";
  if (actionType.includes("Market")) return "market";
  return "unknown";
}

/**
 * Best-effort extraction of the primary entity ID from action params.
 */
export function guessEntityId(params: Record<string, unknown>): string {
  return (
    (params.orderId as string) ??
    (params.order_id as string) ??
    (params.driverId as string) ??
    (params.driver_id as string) ??
    (params.ticketId as string) ??
    (params.ticket_id as string) ??
    (params.market as string) ??
    "unknown"
  );
}
