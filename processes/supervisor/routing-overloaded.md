---
agent: supervisor
trigger: routing_overloaded
priority: high
version: "1.0"
---

# Routing: Overloaded Drivers

**Trigger:** Courier has too many orders, causing cascading delays.

**Check First:**
- HUD: Red = overloaded. Numbers: order count, conflict count, late count.
- Order table variances for the courier.

**Steps:**
1. **Find most efficient route** and communicate it to courier (closest deliveries first).
2. **Reroute excess orders** to Green or Blue couriers. Can reroute before At Restaurant status. Target orders that haven't started, are furthest from current route, or going opposite direction.
3. **Communicate:** if rerouting en-route courier, CALL them. Notify restaurant of any time changes. Notify customer of delays.
4. **Prevent future overload:** max 3 in-bag orders (food quality). Check HUD regularly, assign new orders to Green/Blue not Yellow/Red. Bundle only when all 3 rules met (addresses near, restaurants close, <5 min pickup gap). Trainees (orange vest) = single orders only.
5. **When all couriers overloaded:** push for on-call couriers, ask finishing couriers to extend, wait 15-20 min for response, then contact driver relations. Last resort = Takeout Only (supervisor).

**Escalate If:**
- All couriers in market overloaded, no capacity to rebalance
- Need push notification or driver relations assistance
- Takeout Only consideration
