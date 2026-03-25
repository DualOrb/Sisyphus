---
agent: driver-comms
trigger: assignment_unconfirmed
priority: high
version: "1.0"
---

# Process: Assignment Follow-Up

## Trigger

When a driver has been assigned to an order but has not acknowledged or begun moving toward the restaurant. Detected by the supervisor or Market Monitor when `DriverAssignedTime` is set but `EnrouteTime` remains null after the expected acknowledgment window.

## Prerequisites

Before following up, gather context:
- [ ] `get_order_details(orderId)` — confirm `DriverAssignedTime` is set and `EnrouteTime` is null
- [ ] `query_drivers({ driverId: order.DriverId })` — check driver's current status (`Available`, `Paused`, `ConnectionId`)
- [ ] `get_entity_timeline("driver", order.DriverId, hours=1)` — recent interactions with this driver
- [ ] `query_orders({ driverId: order.DriverId })` — check if driver has multiple active orders (may be completing another)

## Decision Tree

### Step 1: Verify the Assignment is Still Active

Before sending any message:
1. Re-check `OrderStatus` — if the order has been cancelled, completed, or reassigned, stop
2. Re-check `DriverId` — if a different driver is now assigned, stop
3. Re-check `EnrouteTime` — if the driver has started moving since the alert was raised, stop

If the assignment is still active and unacknowledged, proceed.

### Step 2: Assess Time Since Assignment

Calculate: `now - DriverAssignedTime` (Unix epoch seconds)

| Elapsed Time | Status | Action |
|-------------|--------|--------|
| < 3 minutes | Normal | No follow-up yet — driver may be finishing another task |
| 3-5 minutes | First follow-up | Send a polite check-in message |
| 5-8 minutes | Second follow-up | Send a more direct message |
| 8-11 minutes | Third follow-up | Final message before escalation |
| > 11 minutes | Escalate | Alert supervisor for potential reassignment |

### Step 3: First Follow-Up (3 minutes)

Send via `execute_action("FollowUpWithDriver", { driverId, orderId })`:

> "Hi {firstName}, you've been assigned order {orderIdKey} from {restaurantName}. Are you heading there?"

- Tone: friendly, confirming
- Purpose: nudge without pressure

### Step 4: Second Follow-Up (5 minutes, if no response)

Verify cooldown has elapsed (ontology layer enforces 3-minute minimum for assignment reminders).

> "Hey {firstName}, just checking in on order {orderIdKey}. The customer is waiting — can you confirm you're on it?"

- Tone: slightly more urgent, mentions customer
- Purpose: convey importance without being accusatory

### Step 5: Third Follow-Up (8 minutes, if no response)

> "{firstName}, this is the last check on order {orderIdKey}. If you can't take this one, please let me know and we'll reassign."

- Tone: direct, offers an out
- Purpose: final attempt before escalation

### Step 6: Escalation (11 minutes, if no response)

After 3 unanswered follow-ups:
1. Stop messaging the driver — further messages will not help
2. Escalate to supervisor: `request_clarification({ urgency: "high", category: "driver_unresponsive", driverId, orderId, followups_sent: 3, elapsed_minutes: N })`
3. Supervisor will decide whether to:
   - Reassign the order to another available driver
   - Attempt to reach the driver through other means
   - Mark the driver as unresponsive (see `no-response-protocol.md`)

## Special Cases

### Driver Has Multiple Active Orders

If `query_orders({ driverId })` shows the driver has another active order:
- Check if that order is in transit (`OrderInTransitTime` is set)
- If the driver is delivering another order, extend the wait to 5 minutes before first follow-up
- Adjust first message: "Hi {firstName}, I see you're on a delivery. Order {orderIdKey} from {restaurantName} is also assigned to you — heading there after your current drop-off?"

### Driver is Paused or Offline

If `driver.Paused == true` or `driver.ConnectionId == null`:
- The driver may have gone offline after assignment
- Skip the follow-up messages — they won't be received
- Immediately escalate to supervisor for reassignment
- Include in escalation: "Driver appears to be offline/paused since assignment"

### Order Has Become Late

If the order's `isLate` computed property is true during the follow-up process:
- Increase urgency — shorten the follow-up intervals by 1 minute each
- Add urgency context to escalation: "Order is now late — customer impact increasing"

## Cooldown Rules

| Action | Minimum Wait | Max Attempts |
|--------|-------------|--------------|
| Assignment follow-up message | 3 minutes | 3 |
| Escalation to supervisor | 0 (after 3 follow-ups) | 1 |

Note: Cooldowns are enforced by the ontology layer. If you attempt to send a follow-up before the minimum wait, you will receive `COOLDOWN_BLOCKED` with `seconds_remaining`.

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `FollowUpWithDriver` | YELLOW | Sending a follow-up message about the assignment |
| `SendDriverMessage` | YELLOW | Custom message if the template doesn't fit |
| `ReassignOrder` | YELLOW | Only after supervisor approves reassignment |
| `AddTicketNote` | GREEN | Documenting the follow-up chain |
| `request_clarification` | — | Escalating after 3 unanswered follow-ups |

## Escalation

Escalate to supervisor if:
- 3 follow-up messages sent with no response
- Driver appears offline or paused during an active assignment
- Order becomes late during the follow-up process
- Driver responds saying they cannot take the order (requires reassignment coordination)

## Logging

All follow-up messages and escalations are logged automatically by the ontology action layer. The audit trail will show the full sequence: assignment time, each follow-up with timestamp, and the escalation if it occurs.
