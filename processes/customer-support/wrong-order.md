---
agent: customer-support
trigger: ticket_type_wrong_order
priority: critical
version: "1.0"
---

# Process: Wrong Order Resolution

## Trigger

When a support ticket with `IssueType: "Wrong Order"` (or `IssueType: "Other"` with a description indicating the customer received entirely the wrong food) is assigned to the Customer Support agent. This is always treated as **critical priority** because the customer has food they cannot eat and paid for food they did not receive.

## Prerequisites

Before investigating, gather full context:
- [ ] `query_tickets({ issueId: "{IssueId}" })` -- get the ticket with `Description`, `Messages`, `Notes`, `Actions`
- [ ] `get_order_details(ticket.OrderId)` -- full order including `OrderItems`, `OrderTotal`, `DriverId`, `RestaurantId`
- [ ] `get_entity_timeline("order", ticket.OrderId, hours=4)` -- recent actions on this order
- [ ] `query_orders({ driverId: order.DriverId, status: ["Completed", "EnRoute"] })` -- check if the driver was delivering multiple orders simultaneously (possible bag swap)
- [ ] `get_entity_timeline("customer", ticket.Originator, hours=720)` -- check for refund patterns (last 30 days)
- [ ] `query_restaurants({ restaurantId: order.RestaurantId })` -- restaurant info

**Reminder:** All monetary values are in **cents** (integers). `OrderTotal: 6695` means $66.95.

## Step 1: Verify the Complaint

A "wrong order" means the customer received food that does not match their `OrderItems` at all -- not a partial mismatch (that would be "missing items" or "partial wrong order").

Check the ticket `Description` and `Messages` for details:
- Did the customer receive a completely different order (bag swap)?
- Did the customer receive the right restaurant but wrong items?
- Did the customer receive food from a different restaurant entirely?

**Verification against order data:**
1. Review `OrderItems` -- what did the customer actually order?
2. If the driver had multiple orders (`query_orders({ driverId })` returned 2+ concurrent deliveries around the same time), a bag swap is likely
3. If the driver had only one order, the restaurant likely packed the wrong food

## Step 2: Identify the Root Cause

### Bag Swap (Driver Had Multiple Orders)

**Detection:** Driver was assigned to 2+ orders around the same time period. Check orders where:
- Same `DriverId`
- `OrderInTransitTime` values are within 600 seconds (10 min) of each other
- Different `UserId` values

If confirmed as a bag swap:
- **Both customers** may be affected -- check if there's a corresponding ticket from the other customer
- Flag the driver for multi-order handling review
- The restaurant is NOT at fault

### Restaurant Packed Wrong Order

**Detection:** Driver had only one order, OR the wrong food is from the correct restaurant but wrong items.

If confirmed as a restaurant error:
- Restaurant is at fault
- **Always** create a restaurant health note

### Unknown Cause

If you cannot determine the cause from the available data, proceed with the full refund anyway -- the customer should not suffer while the investigation continues.

## Step 3: Resolution — Always Full Refund

A wrong order is **always** a full refund scenario. The customer paid for food they did not receive and has food they did not order (which they may not be able to eat due to dietary restrictions or preferences).

**Refund amount:** `OrderTotal` (the complete order total in cents, including subtotal, tax, delivery fee, and tip)

```
refund_amount = OrderTotal  // Full amount in cents
```

**Tier check:**
- If `OrderTotal < 2500` (under $25.00): ORANGE tier -- process automatically
- If `OrderTotal >= 2500` (>= $25.00): RED tier -- stage for human approval

Since most orders exceed $25.00, this will almost always be RED tier:
```
request_clarification({
  urgency: "high",
  category: "financial",
  recommended_action: "full_refund",
  amount_cents: OrderTotal,
  orderId: "...",
  issueId: "...",
  reasoning: "Wrong order delivered — customer received entirely wrong food. Full refund recommended."
})
```

## Step 4: Offer Reorder or Refund

Give the customer a choice:

### Option A: Reorder

If the customer wants the same order re-delivered:
- This requires human coordination -- Sisyphus cannot create a new order
- Escalate to supervisor: `request_clarification({ urgency: "high", category: "reorder_request", orderId: "...", customerId: "..." })`
- The customer still receives the refund for the wrong order

### Option B: Full Refund Only

If the customer does not want a reorder:
- Process the full refund (or stage for human approval if RED tier)
- Close the ticket

## Step 5: Create Restaurant Health Note

**This is mandatory for every wrong order ticket.** Wrong orders indicate a packing or labeling issue at the restaurant that will recur without intervention.

```
execute_action("AddTicketNote", {
  ticketId: "...",
  note: "RESTAURANT HEALTH: RestaurantId {RestaurantId} ({RestaurantName}) — WRONG ORDER delivered to customer. Order {OrderIdKey} contained items not matching OrderItems. Cause: {bag_swap | restaurant_error | unknown}. This restaurant should be reviewed for order accuracy. Full refund of {OrderTotal} cents issued."
})
```

If the restaurant has had 2+ wrong order reports in the last 30 days:
```
request_clarification({
  urgency: "high",
  category: "restaurant_health",
  restaurantId: "...",
  pattern: "Restaurant has had N wrong order reports in the last 30 days. Recommend restaurant outreach.",
  recommendation: "Contact restaurant to review packing/labeling procedures"
})
```

## Step 6: Flag Driver if Bag Swap

If the wrong order was caused by a bag swap (driver delivering multiple orders):

```
execute_action("AddTicketNote", {
  ticketId: "...",
  note: "DRIVER FLAG: DriverId {DriverId} — bag swap on concurrent deliveries. Orders {order1_IdKey} and {order2_IdKey} likely swapped. Driver was handling multiple orders simultaneously."
})
```

This is documented for review but Sisyphus does **not** penalize drivers directly -- that is a human management decision (see `no-response-protocol.md` for the same principle).

## Step 7: Communicate with Customer

### Template: Wrong Order — Full Refund

> "We sincerely apologize -- you received the wrong order. A full refund of ${OrderTotal/100} has been submitted and should appear on your statement within 3-5 business days. Would you like us to arrange a reorder of your original meal?"

### Template: Wrong Order — Staged for Approval (RED tier)

> "We sincerely apologize -- you received the wrong order. We've submitted a full refund request for ${OrderTotal/100} and it's being processed now. Would you also like us to arrange a reorder?"

### Template: Bag Swap Identified

> "We apologize -- it appears your order may have been mixed up with another delivery. A full refund of ${OrderTotal/100} has been submitted. We've flagged this so it doesn't happen again."

## Step 8: Resolve the Ticket

1. Process or stage the refund (Step 3)
2. Send customer message (Step 7)
3. Create restaurant health note (Step 5, mandatory)
4. Flag driver if applicable (Step 6)
5. Close the ticket:
   ```
   execute_action("ResolveTicket", {
     ticketId: "...",
     resolution: "Wrong order delivered. Cause: {cause}. Full refund of ${OrderTotal/100} ({OrderTotal} cents) issued/staged. Restaurant flagged. Reorder: {requested/declined/not_offered}."
   })
   ```

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `ResolveTicket` | YELLOW | Closing the ticket with full resolution notes |
| `AddTicketNote` | GREEN | Investigation notes, restaurant health flag, driver flag |
| `EscalateTicket` | GREEN | Reorder request, restaurant pattern, safety concern |
| `IssueRefund` | ORANGE (< 2500) / RED (>= 2500) | Full refund of `OrderTotal` |
| `SendCustomerMessage` | YELLOW | Communicating resolution and reorder option |
| `request_clarification` | -- | RED tier approval, reorder coordination, restaurant health pattern |

## Cooldown Rules

| Action | Minimum Wait | Max Attempts |
|--------|-------------|--------------|
| Customer message (same ticket) | 5 minutes | 3 |
| Resolve ticket | 0 (once) | 1 |
| Add note | 0 (immediate) | -- |

## Escalation

Escalate to supervisor if:
- Financial remedy >= 2500 cents ($25.00) -- requires human approval (most wrong orders will hit this)
- Customer requests a reorder (requires human coordination)
- Restaurant has 2+ wrong order reports in the last 30 days (pattern)
- Bag swap affected multiple customers and a second ticket exists
- Customer mentions food safety concern (allergens in the wrong food) -- escalate as SAFETY
- Customer threatens legal action or media -- escalate per `escalation-criteria.md` Category 3

## Logging

All actions are logged automatically by the ontology action layer. Ensure your `reasoning` string includes: the identified cause (bag swap, restaurant error, unknown), the full refund amount, and that the restaurant health note was created.
