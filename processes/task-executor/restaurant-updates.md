---
agent: task-executor
trigger: restaurant_update_request
priority: normal
version: "1.0"
---

# Process: Restaurant Updates

## Trigger

When any agent requests a change to restaurant information. The Task Executor is a shared utility — it can be invoked by the supervisor, Market Monitor, Driver Comms, or Customer Support agent whenever an admin task is needed.

Common triggers:
- Support ticket reveals incorrect restaurant info (Customer Support invokes Task Executor)
- Market Monitor detects a restaurant is offline but still receiving orders
- Driver reports restaurant is closed or has moved (Driver Comms invokes Task Executor)
- Supervisor delegates a scheduled maintenance update

## Prerequisites

Before making any changes, gather the current state:
- [ ] `query_restaurants({ restaurantId: "{RestaurantId}" })` — full restaurant record including `RestaurantName`, `Phone`, `Email`, `DeliveryZone`, `KitchenHours`, `DefaultHours`, `DeliveryAvailable`, `Restaurant` (active flag), `POSETA`, `LastHeartbeat`
- [ ] `get_entity_timeline("restaurant", restaurantId, hours=24)` — recent changes to avoid conflicting with another update
- [ ] `query_orders({ restaurantId, status: ["Pending", "Confirmed", "Ready"] })` — check for active orders that might be affected by the change
- [ ] If the update was triggered by a ticket: `query_tickets({ restaurantId })` — understand the reported issue

## Types of Updates

### 1. Hours Update

Modify `KitchenHours` (internal prep hours) or `DefaultHours` (customer-facing display hours).

**Important:** Hours are stored as **minutes from midnight** (e.g., 660 = 11:00 AM, 1320 = 10:00 PM).

Verification steps:
1. Confirm the new hours come from a reliable source (restaurant owner request via ticket, vendor portal submission, or verified phone call noted in ticket)
2. Check if the restaurant has active orders that fall outside the new hours — if so, flag to supervisor before applying
3. Verify the hours are reasonable (opening time < closing time, not set to 24/7 unless intentional)

Action:
```
execute_action("UpdateRestaurant", {
  restaurantId: "...",
  field: "KitchenHours",
  value: { "Monday": { open: 660, close: 1320 }, ... },
  reason: "Restaurant requested hours change via ticket #IssueId"
})
```

### 2. Delivery Status Toggle

Toggle `DeliveryAvailable` to pause or resume delivery for a restaurant.

Verification steps:
1. If pausing: check for active orders — warn the requesting agent if orders will be affected
2. If resuming: verify `LastHeartbeat` is fresh (< 5 minutes old) — restaurant tablet should be online
3. Check `Restaurant` (active flag) — if the restaurant is inactive (`Restaurant: false`), do not toggle delivery

Action:
```
execute_action("UpdateRestaurant", {
  restaurantId: "...",
  field: "DeliveryAvailable",
  value: true | false,
  reason: "Paused due to tablet offline / Resumed after restaurant confirmed ready"
})
```

### 3. Contact Information Update

Update `Phone`, `Email`, or address fields.

Verification steps:
1. Contact changes should come from a verified source (restaurant owner, vendor portal, or manager confirmation)
2. Do NOT update contact info based solely on a driver or customer report — flag it for human verification
3. Validate format: phone should match expected pattern, email should be valid

Action:
```
execute_action("UpdateRestaurant", {
  restaurantId: "...",
  field: "Phone",
  value: "new-phone-number",
  reason: "Updated per restaurant owner request in ticket #IssueId"
})
```

### 4. Restaurant Pause/Unpause

Toggle the `Restaurant` active flag (different from `DeliveryAvailable` — this is the master switch).

**This is a significant action.** Pausing a restaurant removes it from the customer-facing app entirely.

Verification steps:
1. Confirm the pause request is legitimate (health violation, restaurant request, persistent issues)
2. Check for active orders — all must be handled first (cancel, complete, or reassign)
3. This should almost always be escalated to a human first

Action:
```
execute_action("UpdateRestaurant", {
  restaurantId: "...",
  field: "Restaurant",
  value: false,
  reason: "Restaurant requested temporary closure / Health issue reported"
})
```

**Tier:** RED — always requires human approval to deactivate a restaurant.

### 5. Prep Time Update (POSETA)

Update the restaurant's estimated preparation time in minutes.

Verification steps:
1. Check `RestaurantHealthCache` for historical prep time data
2. If the new `POSETA` is significantly different from historical average (>50% change), flag to supervisor
3. Reasonable range: 5-60 minutes

Action:
```
execute_action("UpdateRestaurant", {
  restaurantId: "...",
  field: "POSETA",
  value: 20,
  reason: "Adjusted prep time based on recent order data"
})
```

## Verification Before All Changes

Every restaurant update must pass these checks:

1. **Source verification**: Where did the request originate? Ticket ID, agent name, or monitoring alert?
2. **Active order impact**: Are there orders in progress that this change would affect?
3. **Freshness**: Has someone else already made this change? Check `get_entity_timeline` to avoid duplicates
4. **Reasonableness**: Does the change make sense given the restaurant's current state?

If any check fails, do NOT proceed. Report back to the requesting agent with the issue.

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `UpdateRestaurant` | YELLOW | Modifying hours, contact info, POSETA, delivery status |
| `PauseRestaurant` | RED | Deactivating a restaurant entirely (master switch) |
| `UnpauseRestaurant` | YELLOW | Reactivating a previously paused restaurant |
| `AddTicketNote` | GREEN | Documenting the change on a related ticket |

## Cooldown Rules

| Action | Minimum Wait | Notes |
|--------|-------------|-------|
| Update same field (same restaurant) | 5 minutes | Prevent rapid toggling |
| Pause/unpause (same restaurant) | 15 minutes | Prevent flapping |

## Escalation

Escalate to supervisor (who may escalate to human) if:
- The update would affect active orders
- The request is to deactivate a restaurant (RED tier)
- The change source cannot be verified
- Multiple conflicting updates are requested for the same restaurant
- The restaurant has `RestaurantHealthCache` issues suggesting a deeper problem

## Audit Requirements

Every restaurant update is logged by the ontology action layer with:
- `restaurantId` and `RestaurantName`
- Field changed, old value, new value
- Reason string (must reference the source: ticket ID, alert, or requesting agent)
- Timestamp and executing agent identity

These records are reviewable in the dispatch activity log and included in the shift summary.
