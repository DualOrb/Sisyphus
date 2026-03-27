---
agent: customer-support
trigger: ticket_type_wrong_order
priority: critical
version: "1.0"
---

# Wrong Order Resolution

**Trigger:** Ticket with IssueType "Wrong Order" -- customer received entirely wrong food.

**Check First:**
- Ticket Description and Messages
- Full order including OrderItems, OrderTotal, DriverId, RestaurantId
- Whether driver had multiple concurrent orders (bag swap indicator)
- Customer refund history last 30 days

**Steps:**
1. Verify complaint is "entirely wrong food" (not partial -- that is missing items).
2. Determine cause: driver had 2+ concurrent deliveries with close InTransitTime = likely bag swap (driver error, not restaurant). Single order = restaurant packed wrong food.
3. Always full refund of OrderTotal. Most will be RED tier (>=$25) -- stage for human approval.
4. Offer customer choice: reorder (escalate to supervisor, cannot create new order) or refund only.
5. **Mandatory:** create restaurant health note on every wrong order ticket. If restaurant has 2+ wrong orders in 30 days, escalate for restaurant outreach.
6. If bag swap: also flag driver in ticket note for multi-order handling review. Do NOT penalize driver directly.
7. If customer mentions allergens in wrong food: escalate as SAFETY immediately.

**Escalate If:**
- Refund >= $25 (almost always for wrong orders)
- Customer requests reorder
- Restaurant has 2+ wrong order reports in 30 days
- Bag swap affected multiple customers
- Allergen/safety concern
- Customer threatens legal action or media
