---
agent: driver-comms
trigger: driver_unresponsive
priority: high
version: "1.0"
---

# Process: No-Response Protocol

## Trigger

When a driver has failed to respond to multiple communication attempts. This process is invoked after `assignment-followup.md` exhausts its attempts, or when any agent detects a driver who is unreachable during an active delivery.

## Prerequisites

Before declaring a driver unresponsive, confirm:
- [ ] `get_entity_timeline("driver", driverId, hours=2)` — verify follow-up attempts were actually sent
- [ ] `query_drivers({ driverId })` — current status: `Available`, `Paused`, `ConnectionId`
- [ ] `query_orders({ driverId, status: ["Confirmed", "Ready", "InTransit"] })` — active orders for this driver
- [ ] Check `DriverLatestMessage` for this driver — when was their last message and who sent it?

## Graduated Response

### Phase 1: Message (0-3 minutes)

**Already completed by `assignment-followup.md` or `driver-messaging.md`.**

The first attempt at contact is a standard message via `SendDriverMessage`. This phase is documented here for completeness.

- Action: `execute_action("SendDriverMessage", { driverId, message: "..." })`
- Wait: 3 minutes for response

### Phase 2: Follow-Up (3-8 minutes)

**Typically completed by `assignment-followup.md`.**

Two additional follow-up messages at increasing urgency.

- Action: `execute_action("FollowUpWithDriver", { driverId, orderId })`
- Messages become more direct with each attempt
- Wait: 3 minutes between each follow-up
- Max attempts: 2 additional (3 total including Phase 1)

### Phase 3: Call Escalation (8-11 minutes)

When all message-based contact has failed:

1. Escalate to supervisor with a call request:
   ```
   request_clarification({
     urgency: "high",
     category: "driver_unresponsive",
     driverId: "...",
     orderId: "...",
     recommendation: "Human dispatcher should attempt phone call",
     driver_phone: driver.Phone,
     last_message_at: DriverLatestMessage.ts,
     followups_sent: 3
   })
   ```
2. Sisyphus cannot make phone calls — this requires human intervention
3. The human dispatcher can call the driver's `Phone` number from the `ValleyEats-Drivers` table

### Phase 4: Reassignment (11+ minutes)

If the driver remains unreachable after the call escalation window:

1. Supervisor initiates reassignment of all active orders for this driver:
   - For each active order: `execute_action("ReassignOrder", { orderId, reason: "Driver unresponsive after 3 messages and call attempt" })`
   - `ReassignOrder` is YELLOW tier — can proceed without human approval
2. Notify the customer if the order is late:
   - Delegate to Customer Support to send an update
3. Mark the driver as unresponsive in the shift notes

## When to Mark a Driver as Unresponsive

A driver is considered unresponsive when ALL of the following are true:
- 3+ messages sent with no reply (check `DriverMessages` table — no message from driver after the follow-ups)
- The messages are confirmed delivered (driver's `ConnectionId` was not null when sent, OR messages were sent and not returned as undeliverable)
- At least 10 minutes have elapsed since the first follow-up
- A call attempt was made (or escalated for a call attempt)

## Impact on Driver Points

Driver points are tracked in `ValleyEats-DriverPoints` (PK: `DriverId`, SK: `Interval`).

Sisyphus does NOT directly modify driver points — that is handled by existing business logic. However, Sisyphus should:

1. **Document the non-response** in the ticket or shift notes for human review
2. **Flag repeat offenders**: if `get_entity_timeline("driver", driverId, hours=168)` (last 7 days) shows 2+ unresponsive incidents, note this in the escalation
3. **Do not threaten drivers** with point penalties in messages — that is a human management decision

The existing point system already applies:
- `OrderPoints` — points earned for completing orders
- `DropShiftPoints` — penalties for dropping shifts (can go negative)
- Unresponsiveness during an assignment may affect future assignment priority, but this is outside Sisyphus's scope

## Special Cases

### Driver Comes Back Online

If the driver responds at any phase:
1. Immediately acknowledge: "Welcome back, {firstName}. Are you still able to handle order {orderIdKey}?"
2. If yes: cancel the reassignment if not yet completed, resume normal flow
3. If no: proceed with reassignment, thank the driver for letting you know
4. Reset the no-response counter for this driver

### Driver Was on Another Delivery

If investigation reveals the driver was completing another delivery (has an order with `OrderInTransitTime` set):
1. This is not true unresponsiveness — the driver was working
2. Do not mark as unresponsive
3. Extend the grace period by the estimated remaining delivery time
4. Log the context: "Driver was completing order {otherOrderIdKey} during assignment follow-up"

### Active Delivery in Progress

If the driver is unresponsive but their order shows `OrderInTransitTime` is set (food is in the car):
1. This is a **safety concern** — driver may be incapacitated
2. Escalate immediately to supervisor with urgency `critical`
3. Include driver's last known location from `DriverLocationHistory`
4. Human dispatcher should attempt to call the driver and potentially contact emergency services

## Cooldown Rules

| Action | Minimum Wait | Max Attempts |
|--------|-------------|--------------|
| Follow-up message | 3 minutes | 3 total |
| Call escalation | 0 (after 3 messages) | 1 |
| Reassignment request | 0 (after call window) | 1 per order |
| Re-attempt contact (same driver, same shift) | 30 minutes | 1 |

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `SendDriverMessage` | YELLOW | Initial contact attempt |
| `FollowUpWithDriver` | YELLOW | Subsequent follow-ups |
| `ReassignOrder` | YELLOW | After driver confirmed unresponsive |
| `AddTicketNote` | GREEN | Documenting the no-response chain |
| `EscalateTicket` | GREEN | Safety concern during active delivery |
| `request_clarification` | — | Call escalation or safety escalation |

## Logging

The entire no-response sequence is logged by the ontology action layer — each message attempt, each follow-up, the escalation, and any reassignment. This chain is critical for the shift summary and for identifying patterns of driver unreliability.
