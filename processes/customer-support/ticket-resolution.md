---
agent: customer-support
trigger: new_ticket
priority: normal
version: "1.0"
---

# Ticket Resolution

**Trigger:** New or updated ticket assigned from ValleyEats-IssueTracker.

**Check First:**
- Ticket details (issueId, Category, IssueType, Description)
- Full order with timestamps, items, driver, restaurant
- Driver status if applicable
- Restaurant health if applicable

**Steps:**
1. **Cancel Order:** if already completed/cancelled, inform customer and close. If food not prepared (OrderReadyTime null), full refund appropriate but RED tier -- stage for human. If food prepared, partial refund -- escalate with recommendation.
2. **Late Delivery:** confirm actually late. Identify cause (no driver / restaurant / driver / system). Apply delay-based credit per refund-policy.md. Escalate for reassignment if no driver.
3. **Missing Items:** cross-reference reported items vs OrderItems. <$25 = ORANGE partial credit for item value. >=$25 = escalate. Check restaurant health for accuracy patterns.
4. **Wrong Order:** full refund of OrderTotal. Stage for human approval (usually RED). Call request_clarification with recommended_action: "full_refund."
5. **Stale Driver Location:** check DriverLocationHistory and ConnectionId. Connected but stale = GPS issue, not urgent. Disconnected during active delivery = safety concern, escalate.
6. **Other driver issues:** behavior = escalate to supervisor. Availability = check shifts and status. Document findings.
7. **Resolution steps:** complete investigation > determine path (refund/credit/apology/escalation) > apply per refund-policy.md > communicate with customer (acknowledge, explain, resolve -- 1 sentence each) > ResolveTicket with notes.

**Escalate If:**
- Financial impact >= $25 (human approval)
- Customer threatening legal action or media
- Safety issues
- Cannot determine cause after investigation
- Customer has 3+ issues in last 30 days (pattern)
