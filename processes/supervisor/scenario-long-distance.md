---
agent: supervisor
trigger: scenario_long_distance
priority: high
version: "1.0"
---

# Scenario: Courier Going Long Distance in Multiple Directions

**Trigger:** Courier assigned orders in opposite directions, common with cross-market deliveries when courier resources are limited.

**Check First:**
- Map view of all courier orders and directions
- Ready and delivery times for each order
- Available couriers in affected zones

**Steps:**
1. **Modify order ready times immediately** to reduce delays. Only with accurate updates. >10 min change = call restaurant. Prefer earlier adjustments.
2. **Ensure closest deliveries first** for maximum freshness and minimal backtracking.
3. **Adjust market delay** to prevent new conflicting assignments during the long-distance trip.
4. **Cross-market orders (red/blue background):** bundle as much as possible. Plan return trips (e.g., Pembroke-to-Petawawa courier gets a Petawawa return order). Or give local orders in destination market.
5. **Top-ups:** eligible cross-market routes qualify for $4.50 top-up (add only after order completed).
6. **If route truly unworkable:** reroute one or more orders to different courier. If already en route, CALL them.
7. Max 3 in-bag orders. Check HUD for overload.

**Escalate If:**
- Delivery radius needs reducing due to insufficient couriers (supervisor only)
- Past maximum delay despite adjustments (Takeout Only consideration)
- Courier refuses long-distance orders (acknowledge, explain position, direct further questions to relations@valleyeats.ca)
