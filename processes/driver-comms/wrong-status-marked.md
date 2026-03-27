---
agent: driver-comms
trigger: courier_marked_order_incorrectly
priority: normal
version: "1.0"
---

# Courier Marked Order Incorrectly

**Trigger:** Courier set wrong status on an order, causing incorrect tracking for customer/restaurant/dispatch.

**Check First:**
- Current OrderStatus and all timestamps
- Courier's current location and status
- Other active orders for this courier

**Steps:**
1. Identify incorrect status by comparing timestamps against actual courier activity.
2. **Key status rules:** En-Route triggers restaurant notification (some restaurants start prep on this). At Restaurant should only be set when physically inside. In Bag triggers 5-min In Transit countdown. In Transit shows customer live location -- never multiple to different locations. Canceled triggers auto refund -- never set without calling restaurant first.
3. Change the order status to correct value via the order modal (dispatch can change statuses).
4. Notify courier of correction -- friendly and instructive, not accusatory. Explain the impact (e.g., "customer can see your location when In Transit").
5. Mitigate customer impact: if wrong En-Route sent incorrect ETA to restaurant, call with correct ETA. If In Transit confused customer, send reassuring message.
6. **At Restaurant >5 min before pickup:** reach out to courier, ask not to arrive too early. Clear status if they are just sitting outside.
7. Document correction in ticket note.

**Escalate If:**
- Courier repeatedly marks orders incorrectly (pattern -- create ticket for relations@valleyeats.ca)
- Order marked completed/cancelled incorrectly and pay/refund already processed
- Incorrect cancellation triggered auto refund and stopped restaurant payment
- Status correction causes system error or cannot be reverted
