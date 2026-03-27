---
agent: supervisor
trigger: routing_non_optimal
priority: high
version: "1.0"
---

# Routing: Non-Optimal Routes

**Trigger:** Courier assigned orders that create a non-optimal route. Non-optimal routes include: delivering east then west (backtracking), passing a closer delivery to reach a farther one first, or adding >5 km to reach a bundled pickup.

**Check First:**
- Map view of all orders for the courier
- Order table variances (growing gaps = route problems)
- HUD: Yellow may indicate route conflict

**Steps:**
1. **Option 1 -- Reroute:** move order to a closer or better-positioned courier. Can reroute before courier marks At Restaurant. If courier already en route, CALL them. Target Green or Blue couriers.
2. **Option 2 -- Adjust times:** if only one courier available, adjust ready times so they handle orders sequentially (not simultaneously in conflicting directions). Only modify with accurate data. >10 min change = call restaurant.
3. **Option 3 -- Adjust delivery sequence:** instruct courier on optimal order (closest first, no backtracking).
4. **Route evaluation:** pickups and deliveries flow geographically -- closest deliveries first, restaurants close together, <5 min between pickups, cross-market deliveries have return plan. Route must follow delivery-distance order: closest address first. No backtracking (delivering east then west then east again). Maximum 5 km detour for a bundled pickup.
5. **Look for bundling opportunities** that create a better path (same restaurant, same address, same area).
6. **If market is running behind due to non-optimal routes:** find available couriers in 10-15 min, bundle late orders, push for on-call couriers, redistribute timing, re-evaluate delays.

**Escalate If:**
- Routes cannot be fixed due to insufficient couriers
- Delivery radius is root cause (supervisor-only adjustment)
- Past maximum delay despite all adjustments
