---
agent: task-executor
trigger: order_unconfirmed_alert
priority: high
version: "1.0"
---

# Restaurant Unconfirmed Orders

**Trigger:** Restaurant has not confirmed an incoming order within expected timeframes.

**Check First:**
- Order details: OrderPlacedTime, OrderStatus, RestaurantId, POSETA
- Restaurant record: Phone, LastHeartbeat, DeliveryAvailable
- Whether order was already pinged
- Whether restaurant has MULTIPLE unconfirmed orders (pattern = likely tablet issue)

**Steps:**
1. **5 min unconfirmed:** send tablet ping via SendRestaurantMessage. Do NOT ping earlier.
2. **10-15 min before pickup time:** call the restaurant directly. Be respectful and brief. For POSETA >=20 min, call at 15 min before pickup; for <20 min, call at 10 min before.
3. **If confirmed:** verify updated ready time. Relay any delay to customer and driver.
4. **If tablet issues:** follow restaurant-tablet-troubleshooting.md. Offer to relay order verbally.
5. **If declined:** escalate to supervisor immediately -- order must be cancelled or reassigned, customer informed.
6. **If no answer:** try second call after 2-3 min. If still no answer, escalate to supervisor. Consider halting restaurant.
7. **Multiple unconfirmed orders for same restaurant:** check LastHeartbeat. If stale >5 min, skip ping and call immediately. May need to halt restaurant.
8. Communicate delays to customer -- frame as "preparation is taking longer than expected," not restaurant blame.

**Escalate If:**
- Restaurant does not answer after two call attempts
- Multiple orders unconfirmed for same restaurant
- Order is past scheduled pickup time and still unconfirmed
- Restaurant declines the order
- Tablet issues cannot be resolved and restaurant needs halting
