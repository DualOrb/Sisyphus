---
agent: customer-support
trigger: refund_decision
priority: normal
version: "1.0"
---

# Process: Refund & Credit Policy

## Trigger

When the Customer Support agent determines that a financial remedy (refund or credit) is appropriate during ticket resolution. Always consult this file before issuing any refund or credit.

## Prerequisites

Before issuing any financial remedy:
- [ ] `get_order_details(orderId)` — confirm `OrderTotal`, `OrderSubtotal`, `DeliveryFee`, `Tip`, `Tax` (all values in **cents**)
- [ ] `query_tickets({ orderId })` — check for prior refunds or credits on this order
- [ ] `get_entity_timeline("customer", customerId, hours=720)` — check for recent refunds to this customer (last 30 days)
- [ ] Verify the issue is legitimate — do not issue refunds based solely on customer claim without checking order data

**Reminder:** All monetary values in the Orders table are in **cents** (integers). `OrderTotal: 6695` means $66.95. Disputes use dollars (decimals). Always work in cents internally.

## Autonomy Tiers

| Tier | Amount | Approval | Notes |
|------|--------|----------|-------|
| **ORANGE** | < 2500 cents (< $25.00) | Auto after ramp-up period | Sisyphus can issue independently |
| **RED** | >= 2500 cents (>= $25.00) | Always human-approved | Stage the action, include recommendation |

During the initial ramp-up period, ALL refunds and credits may be treated as RED tier (human-approved) regardless of amount, until the system builds confidence.

## Refund Tiers by Issue Severity

### Tier 1: Full Refund — `OrderTotal`

Issue types that warrant a full refund of the entire order total:

| Scenario | Condition | Amount |
|----------|-----------|--------|
| Wrong order delivered | Customer received entirely wrong food | `OrderTotal` (full) |
| Order never delivered | `OrderDeliveredTime` is null AND order is > 60 min old | `OrderTotal` (full) |
| Food safety issue | Contamination, foreign object, allergen mismatch | `OrderTotal` (full) + escalate to safety |
| Double charge | Customer charged twice for same order (verify in Transactions) | `OrderTotal` (one charge) |

For full refunds:
1. Calculate the refund amount = `OrderTotal` (in cents)
2. If `OrderTotal >= 2500`: stage for human approval via `request_clarification`
3. If `OrderTotal < 2500`: execute `IssueRefund` (ORANGE tier)
4. Always include `Tip` in full refund — customer should not pay tip for undelivered/wrong food

### Tier 2: Partial Refund — Percentage of Subtotal

Issue types that warrant a partial refund:

| Scenario | Condition | Amount |
|----------|-----------|--------|
| Missing items | Specific items confirmed missing | Value of missing items (from `OrderItems`) |
| Late delivery (30-45 min late) | `isLate: true`, delay between 30-45 min | 25% of `OrderSubtotal` |
| Late delivery (45-60 min late) | Delay between 45-60 min | 50% of `OrderSubtotal` |
| Late delivery (> 60 min late) | Delay exceeds 60 min | 75% of `OrderSubtotal` |
| Poor food quality | Customer complaint, no safety concern | 25-50% of `OrderSubtotal` (judgment call) |
| Partial wrong order | Some items correct, some wrong | Value of wrong items |

For partial refunds:
1. Calculate the specific amount in cents
2. Apply the tier threshold check (< 2500 vs >= 2500 cents)
3. For missing items: sum the `price` field of missing items from `OrderItems` array
4. For late delivery: calculate based on `OrderSubtotal` (not `OrderTotal` — exclude fees and tip)

### Tier 3: Credit (Store Credit)

Prefer issuing store credit over refund when:
- The issue is minor (slight delay, cold food, small missing item)
- The customer is a frequent orderer (high `totalOrders` count)
- The amount is small (< 1000 cents / $10.00)

| Scenario | Amount |
|----------|--------|
| Minor inconvenience (late < 30 min) | 500 cents ($5.00) credit |
| Small missing item (side, drink) | Value of item as credit |
| Apology gesture (no measurable loss) | 500-1000 cents credit |

Credits use `IssueCredit` action and follow the same tier thresholds.

## Credit vs. Refund Decision Tree

```
Is the customer's money at stake (wrong/undelivered/safety)?
├── YES → REFUND (back to payment method)
│   └── Was the entire order affected?
│       ├── YES → Full refund (Tier 1)
│       └── NO → Partial refund (Tier 2)
└── NO → CREDIT (store credit)
    └── Is the issue minor and customer is a repeat user?
        ├── YES → Credit (Tier 3)
        └── NO → Small partial refund (Tier 2)
```

## Fraud Indicators — Check Before Issuing

Before issuing any refund or credit, check for patterns:

- [ ] Has this customer received 3+ refunds in the last 30 days? → Flag to supervisor
- [ ] Has this customer reported missing items on 3+ consecutive orders? → Flag to supervisor
- [ ] Is the refund amount unusually high for the issue type? → Double-check the order details
- [ ] Does the customer's claim contradict the order timeline data? → Investigate further

If any fraud indicator triggers, escalate to supervisor before issuing:
`request_clarification({ urgency: "high", category: "fraud_review", customerId, pattern: "..." })`

## Multiple Remedies on Same Order

- Only ONE refund or credit per order unless a human approves additional remedies
- If a customer contacts again about the same order, check `ticket.Actions` and `ticket.Notes` for prior remedies
- If a prior remedy was already issued: acknowledge it and explain, do not stack

## Execution

To issue a refund:
```
execute_action("IssueRefund", {
  orderId: "...",
  amount_cents: N,
  reason: "Wrong order delivered — full refund",
  issueId: "..."
})
```

To issue a credit:
```
execute_action("IssueCredit", {
  customerId: "customer@example.com",
  amount_cents: N,
  reason: "Late delivery — 25% of subtotal as credit",
  issueId: "..."
})
```

Always include the `issueId` to link the financial action to the ticket.

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `IssueRefund` | RED (>= 2500) / ORANGE (< 2500) | Returning money to customer's payment method |
| `IssueCredit` | RED (>= 2500) / ORANGE (< 2500) | Adding store credit to customer account |
| `AddTicketNote` | GREEN | Documenting the financial decision and reasoning |
| `ResolveTicket` | YELLOW | Closing the ticket after remedy is applied |

## Logging

All financial actions are logged by the ontology layer with full context: amount, reason, order details, customer history, and the agent's reasoning string. These are flagged for human review in the audit dashboard.
