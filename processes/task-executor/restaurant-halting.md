---
agent: task-executor
trigger: restaurant_halt_request
priority: high
version: "1.0"
---

# Process: Restaurant Halting (Pause / Unpause)

## Trigger

When a restaurant needs to be temporarily stopped from receiving new orders. The Task Executor handles halting as a shared utility -- it can be invoked by the supervisor, Market Monitor, Customer Support, or Driver Comms.

Common triggers:
- Restaurant calls or sends a ticket requesting to be halted
- Kitchen is backed up with orders and cannot accept more
- Equipment malfunction or power outage at the restaurant
- Restaurant closing earlier than their normal close time
- Tablet is offline and cannot be restored (see `restaurant-tablet-troubleshooting.md`)
- Multiple unconfirmed orders indicate the restaurant is unresponsive (see `restaurant-unconfirmed-orders.md`)
- Network/internet issues preventing order reception

## Prerequisites

Before halting, gather the current state:
- [ ] `query_restaurants({ restaurantId: "{RestaurantId}" })` -- full restaurant record including `RestaurantName`, `Phone`, `DeliveryAvailable`, `Restaurant` (active flag), `LastHeartbeat`
- [ ] `query_orders({ restaurantId, status: ["Pending", "Confirmed", "Ready"] })` -- check for active orders that must be handled
- [ ] `get_entity_timeline("restaurant", restaurantId, hours=24)` -- check for recent halt/unhalt actions to avoid flapping

## Understanding Halt vs. Deactivation

There are **two levels** of stopping a restaurant:

| Action | What it does | Severity | Resets automatically? |
|--------|-------------|----------|----------------------|
| **Halt** (`DeliveryAvailable: false`) | Stops new orders from being placed. Restaurant disappears from ordering but remains in the system. | YELLOW | **Yes -- resets the following morning.** Restaurant resumes regular schedule next day. |
| **Deactivate** (`Restaurant: false`) | Removes restaurant from the platform entirely. Master switch. | RED -- requires human approval | No -- must be manually reactivated. |

**In almost all cases, you want Halt, not Deactivate.**

## When to Halt

**Source:** Dispatch Analyst Guide -- Halting.

A restaurant should be halted when:
- **Kitchen is backed up** -- too many orders, they need to stop the flow temporarily
- **Equipment malfunction** -- kitchen equipment, power outage, etc.
- **Closing early** -- restaurant wants to close before their scheduled time (halt is simpler than adjusting hours if it is close to closing time)
- **Tablet/connectivity issues** -- tablet is offline and cannot receive orders
- **Restaurant requests it** -- they call or send a ticket asking to be halted
- **Unresponsive restaurant** -- multiple unconfirmed orders with no response to calls

## How to Halt a Restaurant

### Method 1: Via Dispatch System

Action:
```
execute_action("UpdateRestaurant", {
  restaurantId: "...",
  field: "DeliveryAvailable",
  value: false,
  reason: "Halted: [reason - e.g., kitchen backed up / tablet offline / restaurant request via ticket #IssueId]"
})
```

### Method 2: Via Restaurant Page

1. Navigate to the restaurant's page in the dispatch system
2. Change their status to **"Halted"**

### Restaurant Self-Halt (Inform the Restaurant)

When a restaurant requests a halt, also inform them that they can do this themselves directly on the tablet by pressing the **Halt** button. This empowers them for future situations. The halt button is accessible from the tablet's main interface.

## Handling Active Orders Before Halting

Before setting the halt, check for active orders:

1. **Pending orders (not yet confirmed):**
   - Call the restaurant to confirm whether they can fulfill these orders
   - If yes, let them confirm and fulfill before halting
   - If no, these orders need to be cancelled or reassigned -- escalate to supervisor (cancellation is RED tier)

2. **Confirmed orders (in preparation):**
   - These should be completed. The restaurant has already committed to making them.
   - Confirm with the restaurant that these orders will still go out
   - Do NOT halt until confirmed orders are handled

3. **Ready orders (waiting for courier):**
   - These are already made. Ensure couriers pick them up.
   - These are unaffected by the halt.

## When to Un-Halt (Resume)

**A halt automatically resets the following morning.** The restaurant resumes its regular schedule the next day.

Manual un-halt is needed if:
- The restaurant calls back and says they are ready to resume orders the same day
- The issue that caused the halt is resolved (tablet back online, kitchen caught up)
- A scheduled reopening occurs within the same operating day

### Un-Halt Procedure

Before resuming:
1. Verify `LastHeartbeat` is fresh (< 5 minutes old) -- the tablet should be online
2. Confirm with the restaurant that they are ready to accept orders
3. Check that the underlying issue is actually resolved

Action:
```
execute_action("UpdateRestaurant", {
  restaurantId: "...",
  field: "DeliveryAvailable",
  value: true,
  reason: "Resumed: [reason - e.g., restaurant confirmed ready / tablet back online / kitchen caught up]"
})
```

## Halt as Alternative to Hours Adjustment

**Source:** Dispatch Analyst Guide -- Adjusting Hours.

If a restaurant wants to close early and it is close to their normal closing time, a halt is often simpler than creating Holiday Hours:
- Halt stops new orders immediately
- It automatically resets the next morning -- no cleanup needed
- Confirm with the restaurant that a halt is acceptable before using this shortcut

For situations where the restaurant will be closed for an extended period or needs a precise reopening time, use Holiday Hours instead (see `restaurant-hours-adjustment.md`).

## Deactivation (Master Switch) -- RED Tier

Deactivating a restaurant (`Restaurant: false`) is a severe action that removes it from the platform entirely. This is **always** escalated to a human.

**When deactivation might be needed:**
- Health violation reported
- Restaurant requests permanent removal from the platform
- Persistent issues that cannot be resolved

**Procedure:**
1. Confirm the deactivation request is legitimate
2. Ensure ALL active orders are handled first (cancelled, completed, or reassigned)
3. Escalate to supervisor with full documentation
4. Supervisor escalates to human for approval
5. Only after human approval:
```
execute_action("PauseRestaurant", {
  restaurantId: "...",
  reason: "Deactivated: [reason] - Approved by [human approver name]"
})
```

**Tier:** RED -- always requires human approval.

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `UpdateRestaurant` (DeliveryAvailable) | YELLOW | Halting or un-halting delivery for a restaurant |
| `PauseRestaurant` | RED | Deactivating a restaurant entirely (master switch) |
| `UnpauseRestaurant` | YELLOW | Reactivating a previously deactivated restaurant |
| `AddTicketNote` | GREEN | Documenting the halt/unhalt on a related ticket |

## Cooldown Rules

| Action | Minimum Wait | Notes |
|--------|-------------|-------|
| Halt/unhalt (same restaurant) | 15 minutes | Prevent flapping -- if a restaurant is being halted and unhalted rapidly, there is a deeper issue to investigate |

## Escalation

Escalate to supervisor if:
- Active orders will be affected by the halt (especially confirmed orders that may need cancellation)
- The restaurant needs to be deactivated, not just halted (RED tier)
- The restaurant is flapping (being halted and unhalted repeatedly) -- indicates a systemic issue
- The halt reason suggests a deeper problem (health issue, relationship breakdown, persistent tablet failures)
- Multiple restaurants in the same market need halting simultaneously (possible market-wide issue)

## Audit Requirements

Every halt/unhalt is logged with:
- `restaurantId` and `RestaurantName`
- Action taken (halt or unhalt)
- Reason string referencing the source (ticket ID, phone call, monitoring alert)
- Active orders at time of halt and how they were handled
- Timestamp and executing agent identity

These records are reviewable in the dispatch activity log and included in the shift summary.
