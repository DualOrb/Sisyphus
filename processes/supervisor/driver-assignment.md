---
agent: supervisor
trigger: driver_assignment
priority: high
version: "1.0"
---

# Driver Assignment and Reassignment

**Trigger:** Order needs a driver assigned or reassigned.

**Check First:**
- Current courier assignment and status
- Available couriers (HUD colors: Blue=empty preferred, Green=OK, Yellow=verify route, Red=do NOT add, Black=off-shift)

**Steps:**
1. **Manual assignment:** from order detail (scroll to "assign a driver" box) or dispatch channel (click courier moniker > dropdown). Options: select specific courier, "anyone else" (avoids current driver), "surprise me" (system picks, may return same driver).
2. **When to reassign:** courier requests removal, major delay, closer courier available, overloaded courier (Red), non-optimal route, unassigned order, order late pickup (red box, 10+ min). If courier is already En-Route, CALL them about the swap.
3. **Decision criteria:** (a) distance/location -- use map to predict where courier will be, (b) current load (HUD colors and numbers), (c) capability -- trainees get single orders, Smart Serve required for alcohol, (d) cross-market considerations -- bundle, plan return trips, max 3 in-bag, (e) bundling opportunities -- same restaurant/address/area, <5 min between pickups.
4. **Communication:** rerouting en-route courier = call them. Bundling = tell courier and restaurant(s). Adjusting ready time >10 min = call restaurant. Late pickup = notify restaurant and customer.
5. **Running behind recovery:** find couriers available in 10-15 min, bundle late orders, push for on-call couriers, redistribute via time views, re-evaluate delays. Avoid "Stop." Last resort = Takeout Only (supervisor decision).

**Escalate If:**
- No available couriers in market (need push notification or driver relations)
- Delivery radius needs reducing (supervisor only)
- Takeout Only consideration (supervisor only)
