---
agent: supervisor
trigger: routing_unassigned
priority: high
version: "1.0"
---

# Routing: Unassigned Orders

**Trigger:** Confirmed order has no courier assigned.

**Check First:**
- Why unassigned: no courier scheduled, alcohol order with no Smart Serve courier, or system bug?
- HUD for available couriers (Blue = empty, Green = OK)

**Steps:**
1. **Manually assign:** open order > "assign a driver" box, or click courier moniker area on dispatch > select from dropdown / "anyone else" / "surprise me."
2. **No courier scheduled:** send driver push notification (driver page > Message > select market > SNS for moderate urgency, SMS for urgent). Ask finishing couriers to extend. Wait 15-20 min before contacting driver relations. If truly no coverage, consult supervisor about radius reduction or Takeout Only.
3. **Alcohol order, no Smart Serve:** check HUD for beer emoji couriers. Cannot legally have non-certified courier deliver alcohol. If none available, may need to cancel order and communicate with customer.
4. **System bug:** manually assign, then create ticket for engineering documenting order ID, market, time, what happened.
5. **Proactively use Blue (empty) couriers:** scan order table for reroute candidates or upcoming orders near their location. Idle courier = wasted capacity.

**Escalate If:**
- No couriers available in market (need push or driver relations)
- Alcohol order cannot be assigned (may need cancellation)
- System bug causing repeated unassigned orders
