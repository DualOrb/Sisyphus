---
agent: customer-support
trigger: ticket_type_missing_items
priority: high
version: "1.0"
---

# Missing Items Resolution

**Trigger:** Ticket with IssueType "Missing Items" or description mentioning missing food/incomplete order.

**Check First:**
- Ticket Description and Messages
- Full order including OrderItems array (prices in cents)
- Customer refund history last 30 days
- Restaurant health cache

**Steps:**
1. Identify missing items from complaint; cross-reference against OrderItems by name. If no match, ask customer for clarification.
2. Fraud check: 3+ refunds in 30 days or 3+ consecutive missing-item reports = flag to supervisor before issuing.
3. Calculate refund: sum missing item Price x Quantity (in cents). All items missing = full refund per Tier 1.
4. Credit vs refund: item value >$10 = partial refund. <=10 = store credit (min $5).
5. Tier check: <$25 = ORANGE (auto). >=$25 = RED (human approval).
6. Flag restaurant if: missing value >$15, 3+ missing-item reports in 7 days, multiple items missing (packing issue), or special instructions ignored.
7. Send customer message, apply remedy, resolve ticket noting items, values, and whether restaurant was flagged.

**Escalate If:**
- Fraud indicators triggered
- Amount >= $25
- Entire order missing (may be non-delivery, not just missing items)
- Customer disputes resolution
- Restaurant pattern of missing items across multiple orders
