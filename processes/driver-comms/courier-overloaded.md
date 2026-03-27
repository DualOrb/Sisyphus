---
agent: driver-comms
trigger: courier_overloaded
priority: high
version: "1.0"
---

# Courier Overloaded

**Trigger:** Courier has too many orders and cannot complete them within acceptable timeframes, or dispatch detects cascading delays.

**Check First:**
- All active orders for this courier with addresses, ready times, delivery times
- Available couriers in same zone for reassignment
- Map review: are deliveries in same area or spread across different directions?
- **Key rule: max 3 in-bag orders at one time** (food quality degrades beyond this)

**Steps:**
1. **Assess the route:** map all pickup/delivery locations. Identify closest, most urgent, and outlier orders.
2. **Communicate optimal route** if orders are manageable: "deliver to [closest] first, then [next], then [last]." Closest first for freshness, no backtracking.
3. **Reassign orders that cannot be completed:** prioritize removing orders furthest from current route, with most flexible timing, going opposite direction, or not yet picked up. Find available courier closer to the restaurant.
4. **Adjust ready times with restaurants:** if courier is keeping some orders but will be late to pickups, call restaurant to adjust. If gap between bundled orders >5 min, ask restaurant to have them ready at same time.
5. **Notify affected customers** of delays.
6. **Prevent future overloading:** review if bundles were logical (addresses near each other, restaurants close, <5 min between pickups, route makes sense). Monitor courier rest of shift.

**Escalate If:**
- No available couriers in zone to take reassigned orders
- Delivery radius may need reducing (supervisor-only action)
- Multiple couriers across market overloaded simultaneously (systemic)
- Courier upset/threatening to stop mid-shift
- Food quality compromised on multiple orders, re-dispatches needed
