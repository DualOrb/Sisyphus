---
agent: task-executor
trigger: order_unconfirmed_alert
priority: high
version: "1.0"
---

# Process: Restaurant Unconfirmed Orders

## Trigger

When the Market Monitor or Customer Support agent detects that a restaurant has not confirmed an incoming order within expected timeframes. The Task Executor handles the escalation sequence as a shared utility.

Common triggers:
- Market Monitor flags an order unconfirmed for 5+ minutes
- Customer contacts support asking about order status and the order is still pending restaurant confirmation
- Automated monitoring detects an order approaching pickup time without confirmation

## Prerequisites

Before taking action, gather the current state:
- [ ] `get_order_details(orderId)` -- full order record including `OrderPlacedTime`, `OrderStatus`, `RestaurantId`, `DriverId`, `POSETA`, pickup ETA
- [ ] `query_restaurants({ restaurantId: "{RestaurantId}" })` -- restaurant record including `Phone`, `RestaurantName`, `LastHeartbeat`, `Restaurant` (active flag), `DeliveryAvailable`
- [ ] `get_entity_timeline("order", orderId, hours=1)` -- check if confirmation was attempted or if the order was already pinged
- [ ] `query_orders({ restaurantId, status: ["Pending"] })` -- check if the restaurant has multiple unconfirmed orders (pattern indicating tablet issue vs. single missed order)

## Timing Rules

**Source:** Dispatch Analyst Guide -- Unconfirmed Orders policy.

Orders flow: Customer places order -> Restaurant receives on tablet -> Restaurant confirms or declines.

Key timing thresholds:
- **5 minutes after order placed:** Send first ping to restaurant tablet
- **10-15 minutes before pickup time:** Call the restaurant directly
- **Restaurant should NOT make orders more than 10 minutes before ready time** -- food quality degrades if prepared too early

The goal is to ensure the restaurant has enough time to prepare the food so the courier arrives exactly on time.

## Escalation Sequence

### Step 1: Tablet Ping (at 5 minutes unconfirmed)

If the order has been unconfirmed for 5 minutes since `OrderPlacedTime`, send a reminder via the restaurant tablet messenger.

**Do NOT ping earlier than 5 minutes.** The restaurant may be finishing entering it on their end, and premature pings are annoying during a rush.

Action:
```
execute_action("SendRestaurantMessage", {
  restaurantId: "...",
  message: "You have an order to confirm",
  orderId: "...",
  reason: "Order unconfirmed for 5+ minutes, sending reminder ping"
})
```

After sending, add a note to the order timeline:
```
execute_action("AddOrderNote", {
  orderId: "...",
  note: "Sent tablet ping to restaurant - order unconfirmed at 5 min mark",
  reason: "Unconfirmed order escalation step 1"
})
```

### Step 2: Phone Call (at 10-15 minutes before pickup)

If the order is within 10-15 minutes of its scheduled pickup time and still unconfirmed, call the restaurant directly. The exact threshold depends on the restaurant's typical prep time (`POSETA`).

- For restaurants with `POSETA` >= 20 minutes: call at 15 minutes before pickup
- For restaurants with `POSETA` < 20 minutes: call at 10 minutes before pickup

**Phone call procedure:**
1. Call the restaurant at the number from their restaurant record (`Phone` field)
2. Identify yourself: "Hi, this is [name] calling from Valley Eats dispatch"
3. Inform them of the pending order: "You have an order [Order ID] that hasn't been confirmed yet on your tablet"
4. Ask if they can confirm and begin preparation
5. If they are having tablet issues, troubleshoot (see `restaurant-tablet-troubleshooting.md`) or offer to call in the order details verbally

**Important tone guidance:** Restaurants are stressful environments. Be respectful and brief. Do not sound impatient or accusatory. See `restaurant-communication.md` for empathy guidelines.

Action (log the call):
```
execute_action("AddOrderNote", {
  orderId: "...",
  note: "Called restaurant at [phone] - [outcome: confirmed / will confirm / tablet issue / no answer]",
  reason: "Unconfirmed order escalation step 2 - phone call"
})
```

### Step 3: Handle Outcomes

**If restaurant confirms the order:**
- Verify the updated ready time on the order
- If the ready time has been pushed back, relay the delay to the customer
- If a courier is already assigned and en route, notify Driver Comms of the new timing

**If restaurant reports tablet issues:**
- Follow `restaurant-tablet-troubleshooting.md` to diagnose
- Offer to relay the order details verbally so they can begin preparation
- If the tablet cannot be fixed quickly, offer to halt the restaurant (see `restaurant-halting.md`) after current orders are handled

**If restaurant declines the order:**
- The order must be cancelled or reassigned
- Escalate to supervisor immediately -- customer needs to be informed
- Log the decline reason on the order and any associated ticket

**If restaurant does not answer the phone:**
- Attempt a second call after 2-3 minutes
- If still no answer, escalate to supervisor
- Consider whether the restaurant should be halted to prevent additional unconfirmed orders from stacking up

### Step 4: Customer Communication

Any delay caused by an unconfirmed order must be communicated to the customer. Relay via Customer Support agent:
- Inform the customer that the restaurant is experiencing a delay
- Provide an updated estimated delivery time if available
- Do NOT blame the restaurant to the customer -- frame it as "preparation is taking a bit longer than expected"

## Multiple Unconfirmed Orders (Pattern Detection)

If `query_orders` reveals multiple pending orders for the same restaurant, this signals a systemic issue (likely tablet offline or restaurant overwhelmed):

1. Check `LastHeartbeat` -- if stale (> 5 minutes old), the tablet may be disconnected
2. Call the restaurant immediately (skip the 5-minute ping step)
3. If the restaurant is overwhelmed, discuss halting temporarily (see `restaurant-halting.md`)
4. If the tablet is offline and cannot be restored, halt the restaurant and handle all pending orders individually

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `SendRestaurantMessage` | GREEN | Sending a ping/reminder to the tablet |
| `AddOrderNote` | GREEN | Logging escalation steps on the order |
| `UpdateOrder` | YELLOW | Adjusting ready time after restaurant confirms late |
| `CancelOrder` | RED | If restaurant cannot fulfill -- requires human approval |

## Cooldown Rules

| Action | Minimum Wait | Notes |
|--------|-------------|-------|
| Tablet ping (same order) | 5 minutes | Do not spam the restaurant |
| Phone call (same restaurant) | 3 minutes | Allow time for them to check tablet after first call |

## Escalation

Escalate to supervisor if:
- Restaurant does not answer after two phone call attempts
- Multiple orders are unconfirmed for the same restaurant (pattern issue)
- The order is past its scheduled pickup time and still unconfirmed
- Restaurant declines the order and customer needs to be notified
- Tablet issues cannot be resolved and the restaurant needs to be halted

## Audit Requirements

Every escalation step is logged with:
- `orderId` and `restaurantId`
- Escalation step taken (ping, call, outcome)
- Timestamp and executing agent identity
- Reason string referencing the unconfirmed order timeline

These records are reviewable in the dispatch activity log and included in the shift summary.
