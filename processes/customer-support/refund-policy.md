---
agent: customer-support
trigger: refund_decision
priority: normal
version: "1.0"
---

# Refund & Credit Policy

**Trigger:** Customer Support determines a financial remedy is needed during ticket resolution.

**Check First:**
- Order details: OrderTotal, OrderSubtotal (all values in cents; 6695 = $66.95)
- Prior refunds/credits on this order
- Customer refund history last 30 days
- Verify issue is legitimate against order data

**Steps:**
1. **Autonomy threshold:** <$25 (2500 cents) = ORANGE, auto after ramp-up. >=$25 = RED, always human-approved.
2. **Full refund (OrderTotal):** wrong order entirely, order never delivered (>60 min, no DeliveredTime), food safety issue (also escalate as SAFETY), double charge.
3. **Partial refund:** missing items = sum of item prices. Late 30-45 min = 25% of OrderSubtotal. Late 45-60 min = 50%. Late >60 min = 75%. Poor quality = 25-50% (judgment). Partial wrong order = value of wrong items.
4. **Credit preferred when:** minor issue, frequent customer, amount <$10. Minor delay (<30 min) = $5 credit. Small missing side/drink = item value as credit.
5. **Refund vs credit decision:** customer's money at stake (wrong/undelivered/safety) = refund. Minor inconvenience on repeat user = credit.
6. **Fraud check before issuing:** 3+ refunds in 30 days, 3+ consecutive missing-item reports, amount disproportionate to issue, claim contradicts timeline data -- flag to supervisor.
7. Only ONE remedy per order unless human approves additional.

**Escalate If:**
- Amount >= $25 (2500 cents)
- Fraud indicators triggered
- Customer disputes prior remedy on same order
