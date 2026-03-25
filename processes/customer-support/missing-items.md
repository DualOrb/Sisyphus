---
agent: customer-support
trigger: ticket_type_missing_items
priority: high
version: "1.0"
---

# Process: Missing Items Resolution

## Trigger

When a support ticket with `IssueType: "Missing Items"` (or `IssueType: "Other"` with a description mentioning missing food or incomplete order) is assigned to the Customer Support agent.

## Prerequisites

Before investigating, gather full context:
- [ ] `query_tickets({ issueId: "{IssueId}" })` -- get the ticket with `Description`, `Messages`, `Notes`, `Actions`
- [ ] `get_order_details(ticket.OrderId)` -- full order including `OrderItems` array, `OrderSubtotal`, `OrderTotal`
- [ ] `get_entity_timeline("order", ticket.OrderId, hours=4)` -- recent actions on this order
- [ ] `get_entity_timeline("customer", ticket.Originator, hours=720)` -- customer's recent tickets (last 30 days) to check for refund patterns
- [ ] `query_restaurants({ restaurantId: order.RestaurantId })` -- restaurant info and `RestaurantHealthCache`

**Reminder:** All monetary values in `OrderItems` and `Orders` are in **cents** (integers). An item `Price: 1500` means $15.00.

## Step 1: Identify the Missing Items

Parse the customer's complaint from `ticket.Description` and `ticket.Messages` to determine which items are reported missing.

Cross-reference against the order's `OrderItems` array. Each item in `OrderItems` has:

```
{
  ItemId: "10594197-...",       // UUID
  ItemName: "Sausage & Shrimp Penne",
  Description: "...",
  Price: 3300,                  // Cents — this is the base price
  Quantity: 1,
  MenuOptions: { ... },        // Modifier selections (extras, sizes, etc.)
  Taxable: true,
  Alcohol: false,
}
```

For each reported missing item:
1. Find the matching item in `OrderItems` by name
2. Note the `Price` (in cents) and `Quantity`
3. If the item has `MenuOptions` with additional charges, the total item cost may be higher than `Price` -- check if modifiers added cost

If the customer's reported item does not match any item in `OrderItems`:
- The customer may be confused about what they ordered
- Respond politely asking for clarification: "Could you confirm which item was missing? I see [list of items] on your order."

## Step 2: Check for Fraud Indicators

Before issuing any remedy, check for patterns (per `refund-policy.md`):

- [ ] Has this customer received 3+ refunds in the last 30 days? -> Flag to supervisor
- [ ] Has this customer reported missing items on 3+ consecutive orders? -> Flag to supervisor
- [ ] Does the reported missing item seem inconsistent with the order (e.g., claiming a $50 item is missing from a $15 order)?

If any fraud indicator triggers:
```
request_clarification({
  urgency: "high",
  category: "fraud_review",
  customerId: ticket.Originator,
  pattern: "Customer has reported missing items on N of last M orders",
  orderId: ticket.OrderId
})
```

If no fraud indicators, proceed to resolution.

## Step 3: Calculate Refund Amount

Sum the value of all confirmed missing items:

```
missing_item_total = 0
for each missing item:
  missing_item_total += item.Price * item.Quantity
```

This gives the refund amount in **cents**.

**Special cases:**
- If all items are missing (entire order incomplete): treat as a full refund scenario per `refund-policy.md` Tier 1
- If a side or drink is missing (value < 500 cents / $5.00): prefer store credit over refund
- If the missing item is an alcohol item (`Alcohol: true`): note this -- alcohol refunds may require additional verification

## Step 4: Decide Refund vs. Credit

```
Is the missing item value > 1000 cents ($10)?
├── YES → REFUND (partial — back to payment method)
│   └── Amount = missing_item_total (cents)
└── NO → CREDIT (store credit)
    └── Amount = missing_item_total (cents), minimum 500 cents ($5)
```

**Tier check:**
- If amount < 2500 cents ($25.00): ORANGE tier -- process automatically (after ramp-up period)
- If amount >= 2500 cents ($25.00): RED tier -- stage for human approval

## Step 5: Determine Whether to Contact the Restaurant

**Contact the restaurant** (via ticket note for human follow-up, or via Task Executor to flag restaurant health) if:
- The missing item value exceeds 1500 cents ($15.00)
- The restaurant has had 3+ missing item reports in the last 7 days (check `RestaurantHealthCache`)
- The order included special instructions that were ignored
- Multiple items are missing from the same order (suggests a packing issue, not a single oversight)

**Do NOT contact the restaurant** if:
- Only one small item is missing (side, sauce, drink under 500 cents)
- The order was delivered a long time ago (> 4 hours) -- too late for investigation
- The customer's claim is about quantity ("only got 6 wings instead of 10") -- this is hard to verify remotely

When flagging the restaurant:
```
execute_action("AddTicketNote", {
  ticketId: "...",
  note: "RESTAURANT FLAG: RestaurantId {RestaurantId} ({RestaurantName}) — missing items reported: {item_names}. Total value: {amount} cents. Flagging for restaurant health tracking."
})
```

## Step 6: Communicate with Customer

### Template: Single Item Missing (credit issued)

> "We're sorry to hear your {ItemName} was missing from your order. We've added a ${amount/100} credit to your account. We apologize for the inconvenience."

### Template: Multiple Items Missing (refund issued)

> "We're sorry that several items were missing from your {RestaurantName} order: {item_list}. A refund of ${amount/100} has been submitted and should appear on your statement within 3-5 business days."

### Template: Needs Clarification

> "We're sorry to hear about the issue with your order. Could you let us know which specific items were missing? I see the following on your order: {item_list}."

### Template: Small Missing Item (credit)

> "Sorry about the missing {ItemName}. We've added a ${amount/100} credit to your account for your next order."

## Step 7: Resolve the Ticket

1. Apply the financial remedy:
   ```
   execute_action("IssueCredit", {
     customerId: "customer@example.com",
     amount_cents: N,
     reason: "Missing items: {item_names}. Value: {amount} cents.",
     issueId: "..."
   })
   ```
   OR
   ```
   execute_action("IssueRefund", {
     orderId: "...",
     amount_cents: N,
     reason: "Missing items: {item_names}. Partial refund for item values.",
     issueId: "..."
   })
   ```

2. Send customer message (Step 6)

3. Close the ticket:
   ```
   execute_action("ResolveTicket", {
     ticketId: "...",
     resolution: "Missing items: {item_names}. {refund_type} of ${amount/100} issued. Restaurant flagged: {yes/no}."
   })
   ```

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `ResolveTicket` | YELLOW | Closing the ticket with resolution notes |
| `AddTicketNote` | GREEN | Documenting investigation, restaurant flags |
| `EscalateTicket` | GREEN | Fraud pattern detected, unclear situation |
| `IssueCredit` | ORANGE (< 2500) / RED (>= 2500) | Store credit for small missing items |
| `IssueRefund` | ORANGE (< 2500) / RED (>= 2500) | Refund for significant missing items |
| `SendCustomerMessage` | YELLOW | Communicating resolution to customer |
| `request_clarification` | -- | Fraud review, unclear claims |

## Cooldown Rules

| Action | Minimum Wait | Max Attempts |
|--------|-------------|--------------|
| Customer message (same ticket) | 5 minutes | 3 |
| Resolve ticket | 0 (once) | 1 |
| Add note | 0 (immediate) | -- |

## Escalation

Escalate to supervisor if:
- Fraud indicators triggered (3+ refunds in 30 days, consecutive missing item reports)
- Financial remedy >= 2500 cents (requires human approval)
- Entire order is missing (not just items) -- may indicate non-delivery
- Customer disputes the resolution or requests additional compensation
- Restaurant has a pattern of missing items across multiple orders (flag for restaurant health conversation)

## Logging

All actions are logged automatically by the ontology action layer. Ensure your `reasoning` string includes: which items were missing, their value in cents, and whether the restaurant was flagged.
