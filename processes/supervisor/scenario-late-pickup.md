---
agent: supervisor
trigger: scenario_late_pickup
priority: high
version: "1.0"
---

# Scenario: Order Late Pickup

**Trigger:** Order is ready at restaurant but has not been picked up by courier. Red box appears at 10+ min past pickup time.

**Check First:**
- Why assigned courier is delayed (overloaded, unresponsive, elsewhere)
- HUD for available couriers (Blue=empty, Green=OK)
- Red box / red background status

**Steps:**
1. Determine how long assigned courier is delayed. Use map and ready/delivery times.
2. Attempt to reroute to a courier who can pick up immediately. Click moniker > select another courier / "anyone else."
3. If rerouting not possible, contact assigned courier to prioritize the late order. Phone call better than text if driving.
4. Notify restaurant (communicate delay to avoid remake cost) and customer (apologize for delay).
5. **If no courier available:** send driver push notification (SMS for urgent). Ask finishing couriers to extend. Wait 15-20 min before contacting driver relations.
6. **Prevent:** continuously scan order table for upcoming problems. Reroute future orders before they become late. Bundle late orders if new opportunities exist.

**Escalate If:**
- Delays persist despite all adjustments
- No couriers available (need push or driver relations)
- Supervisor may need to consider Takeout Only as last resort
