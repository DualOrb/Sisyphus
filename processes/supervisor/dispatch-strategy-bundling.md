---
agent: supervisor
trigger: strategy_bundling
context: dispatching
priority: high
version: "1.0"
source: "Dispatch Analyst Guide — Dispatching Strategies: Bundling"
---

# Dispatch Strategy: Bundling

## Core Principle

Group orders with the same courier to maximize efficiency — but only when the route makes sense and timing constraints are met. A bad bundle is worse than no bundle.

---

## What Bundling Is

Bundling means assigning multiple orders to a single courier for a single trip. Instead of the courier making one pickup and one delivery, they make multiple pickups and/or multiple deliveries in a single run.

This reduces total trips, increases courier utilization, and speeds up overall delivery throughput when done correctly.

---

## Three Types of Bundles

### 1. Same Restaurant Bundle

Two or more orders from the same restaurant, assigned to one courier.

**Procedure:**
1. Assign orders from the same restaurant to one courier if the route is acceptable and the pickup times are within 5-10 minutes of each other
2. Communicate the plan with the courier
3. Notify the restaurant of the order groupings so they have all orders ready together

**Why it works:** One pickup stop instead of two. The courier waits once and leaves with both orders.

### 2. Same Address Bundle

Two or more orders going to the same customer address, possibly from different restaurants.

**Procedure:**
1. Assign orders for the same customer to one courier if the route is acceptable within the pickup times
2. Adjust pickup times with restaurants if possible to allow for one-courier bundling
3. Communicate the plan with the courier

**Why it works:** One delivery stop instead of two. Even if pickups are at different restaurants, the courier delivers everything at once.

### 3. Same Area Bundle

Two or more orders being delivered to the same zone or neighborhood, possibly from different restaurants.

**Procedure:**
1. Assign orders being delivered to the same zone to one courier if the route is acceptable within the pickup times — this is especially important for orders between adjacent towns (e.g., Pembroke and Petawawa)
2. Adjust pickup times with restaurants if possible to allow for one-courier bundling
3. Communicate the plan with the courier

**Why it works:** The courier is already going to that area. Adding a second delivery nearby avoids a separate round trip.

---

## When to Bundle — The Three Rules

Orders should ONLY be bundled when ALL of the following conditions are met:

### Rule 1: Delivery Addresses Are Near Each Other

The delivery addresses must be near each other, or one must be on the way to the other. Bundling orders going in opposite directions defeats the purpose entirely.

### Rule 2: Restaurants Are Close Together

The restaurants must be close together so the courier is not driving across town between pickups, which would cause delays for both orders.

### Rule 3: Minimal Time Between Pickups

There must be a minimal amount of time between the pickup of the orders:

- **Maximum gap: 5 minutes.** We do not want a courier waiting 20 minutes with food in their bag just to pick up another order.
- **If the gap is greater than 5 minutes:** Call the restaurant and ask them to have both orders ready at the same time. Adjust the ready times so the courier picks up both at once.

---

## Route Must Make Sense — No Exceptions

Planned bundles may show up as a conflict (yellow background) on the Courier Utilization HUD. This is expected and can be ignored IF the route makes sense.

At all costs, **the route must make sense.**

A good bundle:
- Courier picks up 2 orders
- Delivers them from closest to furthest to ensure maximum freshness and less backtracking

A bad bundle (driver overloaded — try to avoid):
- Orders going in opposite directions
- Courier driving past one delivery to reach the other, then backtracking
- Courier sitting at a restaurant for 15+ minutes waiting for the second order

---

## Communication Requirements

For every bundle:

1. **Tell the courier** what the plan is — which restaurants, which orders, what sequence
2. **Tell the restaurant(s)** about the grouping so they prepare orders on the same timeline
3. **If the courier is overloaded,** communicate delays with the restaurant proactively — take action to prevent overload BEFORE it happens

---

## Bundling During Recovery (Running Behind)

When the market is running behind, bundling becomes even more important:

- Late orders create NEW bundling opportunities that did not exist before (orders that were originally spread apart in time now overlap)
- Look for these emergent bundles to reduce the total number of trips needed to clear the backlog
- See `running-behind.md` Step 2

---

## Bundling Anti-Patterns

| Situation | Why It Fails |
|-----------|-------------|
| Orders in opposite directions | Courier has to backtrack; both orders arrive late |
| Pickup gap > 5 minutes with no restaurant adjustment | Food from first pickup sits in the bag getting cold |
| Bundling on a trainee (orange vest) | Trainees should not handle multi-order runs |
| Bundling when courier is already overloaded (red) | Adding orders to a red courier makes everything later |
| Ignoring delivery sequence | Delivering the far order first while the near one sits in the bag |

---

## Sisyphus Implementation

When evaluating potential bundles:

1. Identify orders with overlapping pickup windows (within 5 minutes)
2. Check if restaurants are geographically proximate
3. Check if delivery addresses are proximate or one is on the route to the other
4. Verify the courier is not already overloaded (must be Green or Yellow on HUD)
5. Verify the courier is not a trainee (unless it is a trivial same-restaurant, same-address bundle)
6. Calculate the route: pickup sequence, then delivery sequence from nearest to farthest
7. If the route makes sense, execute the bundle
8. Notify courier and restaurant(s) of the plan
9. If pickup times need adjustment, coordinate with restaurants and update ready times

Log all bundles in the shift audit trail with the rationale for the grouping.
