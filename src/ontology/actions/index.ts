/**
 * Action registration barrel file.
 *
 * Importing any of the action modules triggers `defineAction()` calls as a
 * side effect, populating the guardrails registry. This file provides:
 *
 *   1. `registerAllActions()` — a single call that ensures every action module
 *      has been loaded (and therefore registered).
 *   2. String constants for every action name, giving callers type-safe
 *      references without magic strings.
 */

// ---------------------------------------------------------------------------
// Action name constants (for type-safe references)
// ---------------------------------------------------------------------------

// -- Order actions --
export const ACTION_ASSIGN_DRIVER_TO_ORDER = "AssignDriverToOrder" as const;
export const ACTION_REASSIGN_ORDER = "ReassignOrder" as const;
export const ACTION_UPDATE_ORDER_STATUS = "UpdateOrderStatus" as const;
export const ACTION_CANCEL_ORDER = "CancelOrder" as const;

// -- Driver communication actions --
export const ACTION_SEND_DRIVER_MESSAGE = "SendDriverMessage" as const;
export const ACTION_FOLLOW_UP_WITH_DRIVER = "FollowUpWithDriver" as const;

// -- Support / ticket actions --
export const ACTION_RESOLVE_TICKET = "ResolveTicket" as const;
export const ACTION_ESCALATE_TICKET = "EscalateTicket" as const;
export const ACTION_ADD_TICKET_NOTE = "AddTicketNote" as const;
export const ACTION_UPDATE_TICKET_OWNER = "UpdateTicketOwner" as const;

// -- Market actions --
export const ACTION_FLAG_MARKET_ISSUE = "FlagMarketIssue" as const;

// ---------------------------------------------------------------------------
// Aggregate list (useful for iteration / validation)
// ---------------------------------------------------------------------------

export const ALL_ACTION_NAMES = [
  ACTION_ASSIGN_DRIVER_TO_ORDER,
  ACTION_REASSIGN_ORDER,
  ACTION_UPDATE_ORDER_STATUS,
  ACTION_CANCEL_ORDER,
  ACTION_SEND_DRIVER_MESSAGE,
  ACTION_FOLLOW_UP_WITH_DRIVER,
  ACTION_RESOLVE_TICKET,
  ACTION_ESCALATE_TICKET,
  ACTION_ADD_TICKET_NOTE,
  ACTION_UPDATE_TICKET_OWNER,
  ACTION_FLAG_MARKET_ISSUE,
] as const;

export type ActionName = (typeof ALL_ACTION_NAMES)[number];

// ---------------------------------------------------------------------------
// Registration loader
// ---------------------------------------------------------------------------

/**
 * Import every action module to trigger their `defineAction()` side effects.
 *
 * Call this once during application bootstrap (e.g. in the Temporal worker or
 * test setup) to ensure the guardrails registry is fully populated.
 */
export async function registerAllActions(): Promise<void> {
  await Promise.all([
    import("./order-actions.js"),
    import("./driver-actions.js"),
    import("./support-actions.js"),
    import("./market-actions.js"),
  ]);
}
