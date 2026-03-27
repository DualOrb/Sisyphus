---
agent: supervisor
trigger: strategy_routing
context: dispatching
priority: high
version: "1.0"
source: "Dispatch Analyst Guide — Order Alignment, Delivery Radius, Routing"
---

# Dispatch Strategy: Routing

**Trigger:** Orders auto-assigned by Supervisor Bot when restaurant confirms. Dispatcher monitors and corrects non-optimal assignments.

**Check First:**
- Assigned courier's current location, existing orders, direction of travel
- Whether the assignment creates conflicts (opposite direction, overloaded, no Smart Serve for alcohol)

**Steps:**
1. **Order alignment:** modify ready times with enough notice to match reality. Prefer earlier adjustments. Only modify with accurate updates from restaurant/courier. If change >10 min, call restaurant.
2. **Delivery radius:** reduce when insufficient couriers for full radius (supervisor-only action). Far-out deliveries remove courier for 30-60 min.
3. **Routing failures to watch:** unassigned orders (manually assign; if bug, ticket for engineering). Overloaded drivers (reroute per balancing). Non-optimal routes (reroute to courier with better path, or adjust times for sequential handling).
4. **Route optimization principles:** Route must follow delivery-distance order: closest address first. No backtracking (delivering east then west then east again). Maximum 5 km detour for a bundled pickup. Leave breathing room between stops.
5. **After each order confirmation:** verify the routing algorithm's assignment is reasonable. If assignment creates a conflict, identify optimal alternative courier and execute reassignment.

**Escalate If:**
- Insufficient couriers for delivery radius (human authorization needed for radius reduction)
- Past maximum delay despite all adjustments (supervisor may authorize Takeout Only)
