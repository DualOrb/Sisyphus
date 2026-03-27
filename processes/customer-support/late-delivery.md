---
agent: customer-support
trigger: ticket_type_late
priority: high
version: "1.0"
---

# Late Delivery Resolution

**Trigger:** Ticket with IssueType "Late Delivery" or description mentioning lateness; or Market Monitor/supervisor detects order past expected window.

**Check First:**
- Ticket details (Category, IssueType, Description, Messages)
- Full order with lifecycle timestamps (all Unix epoch seconds; monetary values in cents)
- Driver status and location
- Restaurant status, LastHeartbeat, POSETA
- Zone health (Score, idealDrivers, drivers)

**Steps:**
1. Confirm order is actually late: expected_delivery = OrderPlacedTime + 45 min. Check which stage is stalled (no driver, food not ready, driver not picked up, driver in transit too long).
2. Identify cause (first match): **A)** No driver assigned -- most critical. **B)** Restaurant delay (not confirmed or food not ready). **C)** Driver delay (slow to start, slow at pickup, slow in transit). **D)** Unknown/system issue.
3. **Cause A:** escalate critical for urgent reassignment. Apply delay refund per policy. **Cause B:** apologize, credit per policy, add restaurant health note. **Cause C:** apologize, credit per policy, document driver delay. **Cause D:** apologize, 50% credit minimum, escalate as system anomaly.
4. Refund tiers: <30 min late = $5 credit. 30-45 min = 25% of OrderSubtotal. 45-60 min = 50%. >60 min = 75%. Never delivered (>60 min, no DeliveredTime) = full OrderTotal refund.
5. If amount >=2500 cents: stage for human approval (RED tier).
6. Send customer message, resolve ticket with cause, delay duration, and remedy applied.

**Escalate If:**
- No driver assigned and order >30 min old
- Refund >= $25 (human approval required)
- Customer has 3+ late delivery tickets in 30 days
- Restaurant shows pattern of delays
- Driver unresponsive during active late delivery (safety)
- Cannot determine cause
