---
agent: supervisor
trigger: map_review
priority: normal
version: "1.0"
---

# Map and Routing Reference

**Trigger:** Using the dispatch map for routing decisions, address troubleshooting, or visual problem detection.

**Check First:**
- Map pins, courier positions, and delivery addresses for current orders

**Steps:**
1. **Navigation:** click customer address in "Customer" column to navigate map to delivery location. Predict where courier ends up after delivery.
2. **Pin colors:** green = on time. Red = late (red box if 10+ min past pickup).
3. **Cross-market orders (red/blue background):** bundle as much as possible, plan return trips, max 3 in-bag. Each cross-market delivery removes courier for 30-60 min.
4. **Address troubleshooting:** use wego.here.com (same mapping system as app). Try different address formats. Confirm pin location with customer. Update customer account after fixing.
5. **Changing address on order:** Modify Order > new address > Geolocate + Calculate > Modify Notes > confirm pin on map. If in transit, CALL driver. Apple Pay/Google Pay cannot be charged extra (Google Pay = Valley Eats absorbs cost).
6. **Spotting problems on map:** courier going wrong direction = reroute. Red pins clustering = restaurant slow or courier stuck. Couriers spread thin = look for finishing deliveries nearby, bundle, push for on-call. Cross-market pulling couriers away = check for return orders.
7. **Route planning:** predict courier position from current delivery. Assign next order based on projected location. For bundles, verify on map that addresses are near each other and restaurants are close. Closest deliveries first.

**Escalate If:**
- Address genuinely cannot be found in mapping system (supervisor may request map update)
- Delivery radius needs adjustment
