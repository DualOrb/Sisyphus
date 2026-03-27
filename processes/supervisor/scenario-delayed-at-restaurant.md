---
agent: supervisor
trigger: scenario_delayed_restaurant
priority: high
version: "1.0"
---

# Scenario: Courier Delayed at Restaurant

**Trigger:** Courier has been waiting at restaurant beyond expected pickup time. Delays <10 min are normal; >10 min cause cascading issues.

**Check First:**
- At Restaurant timestamp and how long courier has been waiting
- Red box around order (10+ min past pickup = serious)
- Courier's upcoming orders

**Steps:**
1. Contact courier for accurate ready time from the restaurant.
2. If courier within 5 min of delivery time and still at restaurant: send customer notification about restaurant delay.
3. Check courier's next pickup. If delay will cause late: reroute next order to available courier, or adjust ready time (call restaurant if >10 min change).
4. If courier has another time-sensitive pickup elsewhere: have them leave and come back, or reroute the delayed order.
5. **Red box (10+ min past pickup):** urgent. Get courier there ASAP. Communicate delay to restaurant (failure to do so = likely covering remake cost). Reroute if needed.
6. **Prevent:** identify consistently late restaurants. Assign couriers with spread-out orders. Call for accurate ETA so courier arrives at right time instead of waiting.

**Escalate If:**
- Chronic restaurant delays (document pattern, escalate to restaurant support team)
- Delay is significant and order is very late (consult supervisor for credit, cancellation, or remake)
