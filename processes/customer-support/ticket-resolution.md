---
agent: customer-support
trigger: new_ticket
priority: normal
version: "1.0"
---

# Process: Ticket Resolution

## Trigger

When a new or updated ticket is assigned to the Customer Support agent by the supervisor. Tickets originate from the `ValleyEats-IssueTracker` table.

## Prerequisites

Before investigating, gather full context:
- [ ] `query_tickets({ issueId: "{IssueId}" })` — get the ticket with `Category`, `IssueType`, `IssueStatus`, `Description`, `Messages`, `Notes`, `Actions`
- [ ] `get_order_details(ticket.OrderId)` — full order with lifecycle timestamps, items, driver, restaurant
- [ ] `get_entity_timeline("order", ticket.OrderId, hours=4)` — recent actions on this order
- [ ] If `ticket.DriverId`: `query_drivers({ driverId: ticket.DriverId })` — driver status and availability
- [ ] If `ticket.RestaurantId`: check `RestaurantHealthCache` and `Restaurant.LastHeartbeat` for restaurant status

## Triage by Category and Type

### Category: "Order Issue"

**IssueType: "Cancel Order"**
1. Check `OrderStatus` — is the order already completed or cancelled?
2. If `OrderStatus` is "Completed" or "Cancelled": inform customer, close ticket
3. If order is active:
   - Check if food has been prepared (`OrderReadyTime` is set)
   - If food not yet prepared: cancellation with full refund is appropriate — but `CancelOrder` is RED tier, so stage for human approval
   - If food is prepared: partial refund may apply — escalate to supervisor with recommendation
4. Call `request_clarification({ urgency: "high", category: "financial", recommended_action: "cancel", amount_cents: OrderTotal })`

**IssueType: "Other" (Late Delivery)**
1. Confirm the order is actually late: check `isLate` computed property or compare `OrderPlacedTime` + expected delivery time vs. `now`
2. Identify the cause:
   - **No driver assigned**: `DriverId` is null, `DriverAssignedTime` is null — driver supply issue
   - **Restaurant delay**: `OrderReadyTime` is null but `DeliveryConfirmedTime` is set — restaurant hasn't prepared food
   - **Driver delay**: `EnrouteTime` or `OrderInTransitTime` set but delivery not complete — driver is slow or stuck
3. Resolution by cause:
   - No driver: flag to supervisor for reassignment, apologize to customer
   - Restaurant delay: note on ticket, consider small credit (see `refund-policy.md`)
   - Driver delay: check driver messages for explanation, consider small credit
4. Communicate with customer (see Communication section below)

**IssueType: "Other" (Missing Items)**
1. Pull `OrderItems` from the order — identify what was ordered
2. Check if a specific item was reported missing in `ticket.Description`
3. Check `RestaurantHealthCache` — is this restaurant known for accuracy issues?
4. Resolution: issue a partial credit for the missing item's value
   - If item value < 2500 cents ($25): process as ORANGE tier (auto after ramp-up)
   - If item value >= 2500 cents: escalate for human approval
5. Add note: `execute_action("AddTicketNote", { issueId, note: "Missing item: [item]. Credit issued: [amount] cents." })`

**IssueType: "Other" (Wrong Order)**
1. Verify the complaint against `OrderItems`
2. This is a full refund scenario — customer received food they didn't order
3. Refund the `OrderTotal` — but since this likely exceeds 2500 cents, stage for human approval
4. Call `request_clarification({ urgency: "high", category: "financial", recommended_action: "full_refund", amount_cents: OrderTotal })`
5. Add apology note to customer

### Category: "Driver Issue"

**IssueType: "Stale Driver Location"**
1. These are often system-generated (`Originator: "Supervisor"`)
2. Check `DriverLocationHistory` for the order — is location actually stale?
3. Check driver's `ConnectionId` — are they still connected via WebSocket?
4. If driver is connected but location is stale: may be a GPS issue, not urgent
5. If driver is disconnected during an active delivery: escalate as driver safety concern
6. Resolve or close based on findings

**IssueType: Other Driver Issues**
1. Check the `Description` field for details
2. If it's about driver behavior → escalate to supervisor (outside AI authority)
3. If it's about driver availability → check `DriverShifts` and `Available` status
4. Document findings: `execute_action("AddTicketNote", { issueId, note: "Investigation: [findings]" })`

## Communication with Customer

When sending a message to the customer (via ticket `Messages`):

**Tone:** Empathetic, concise, solution-focused. Never defensive or blame-shifting.

**Structure:**
1. Acknowledge the issue (1 sentence)
2. Explain what happened, if known (1 sentence)
3. State the resolution or next step (1 sentence)

**Example responses:**

Late delivery:
> "We're sorry your order is taking longer than expected. Your driver is on the way and should arrive shortly. We've added a credit to your account for the inconvenience."

Missing items:
> "We're sorry to hear items were missing from your order. We've issued a credit of $X.XX to your account for the missing [item name]."

Wrong order:
> "We sincerely apologize — you received the wrong order. A full refund has been submitted and should appear on your statement within 3-5 business days."

## Resolution Steps

1. Complete investigation (queries above)
2. Determine resolution path (refund, credit, apology, escalation)
3. Apply resolution action (see `refund-policy.md` for financial decisions)
4. Communicate with customer
5. Update ticket status: `execute_action("ResolveTicket", { issueId, resolution: "..." })`
6. Set `IssueStatus` to "Resolved"

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `ResolveTicket` | YELLOW | Closing a ticket with resolution notes |
| `AddTicketNote` | GREEN | Recording investigation progress or internal notes |
| `EscalateTicket` | GREEN | Issue beyond authority — safety, legal, high-value |
| `IssueCredit` | ORANGE | Partial credit < 2500 cents (auto after ramp-up) |
| `IssueRefund` | RED | Full refund or any amount >= 2500 cents (human-approved) |
| `SendCustomerMessage` | YELLOW | Communicating resolution to customer |

## Cooldown Rules

| Action | Minimum Wait | Max Attempts |
|--------|-------------|--------------|
| Customer message (same ticket) | 5 minutes | 3 |
| Resolve ticket | 0 (once) | 1 |
| Add note | 0 (immediate) | — |

## Escalation

Escalate to supervisor if:
- Financial impact >= 2500 cents ($25) — requires human approval
- Customer is threatening legal action or media (see `escalation-criteria.md`)
- Issue involves safety
- You cannot determine the cause after investigation
- Customer has had 3+ issues in the last 30 days (pattern suggests deeper problem)

## Logging

Handled automatically by the ontology action layer. Every action creates an immutable audit record.
