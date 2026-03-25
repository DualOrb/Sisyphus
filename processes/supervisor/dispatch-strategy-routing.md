---
agent: supervisor
trigger: strategy_routing
context: dispatching
priority: high
version: "1.0"
source: "Dispatch Analyst Guide — Order Alignment, Delivery Radius, Routing, Scenarios"
---

# Dispatch Strategy: Routing

## Core Principle

Orders are automatically assigned to couriers by the routing algorithm (Supervisor Bot) when confirmed by the restaurant. The algorithm makes a best attempt at optimal assignment, but it is not perfect. The dispatcher's job is to monitor assignments and implement corrective measures when things go wrong.

---

## Order Alignment

### What It Is

Order alignment means modifying pickup times to match the reality of courier availability and restaurant preparation schedules.

### Rules

1. **Modify pickup times with enough notice** to align times with accurate courier data
2. **Prefer adjusting earlier rather than later** — when possible, move ready times forward instead of delaying them
3. **Call the restaurant** to ensure they can prepare the order for the adjusted time
4. **Only modify ready times if you have an accurate update** from the restaurant and/or courier

### When to Adjust Ready Times

A dispatcher should only modify the ready time if:

- The courier has provided an accurate update on their ETA
- The restaurant has provided an accurate ETA for when the food will be ready
- The courier will not make it for the initial time AND the dispatcher has an accurate update AND the restaurant has not started preparing the order

### How to Adjust

- Click the ready time directly and add + or - minutes
- Or open the order and manually edit the pickup time
- If the change is greater than 10 minutes, call the restaurant — they may have already started preparing for the original time

---

## Delivery Radius

### When to Reduce the Radius

Reduce a market's delivery radius when the number of available couriers is too low to service the regular market radius. The number of couriers required to service a market varies by market.

### Procedure

1. Determine that courier coverage is insufficient for the full delivery area
2. Request a radius reduction from a supervisor — **the radius can only be adjusted by a supervisor**
3. When the radius is reduced, ensure a notice is displayed in the app alerting users of the change

**Example notice:** "Delivery only available up to 10km from Perth. Our apologies for the inconvenience!"

### Why This Matters

Far-out deliveries pull couriers away from the core zone for extended periods. When you are short on couriers, every long-distance delivery removes capacity from the market for 30-60 minutes. Reducing the radius keeps couriers closer and increases the number of deliveries they can complete per hour.

**Sisyphus implementation:** Radius changes require human authorization. Escalate via `request_clarification({ urgency: "high", category: "radius_reduction", market: "<market>" })`.

---

## Routing Failures to Watch For

### 1. Unassigned Orders

Occasionally confirmed orders are not assigned a courier. Causes:

- No courier scheduled for the market
- An order containing alcohol but no available Smart Serve courier
- A bug in the routing system

**Action:** Manually assign the order to an appropriate courier. If it is a system bug, create a ticket for engineering.

### 2. Overloaded Drivers

The routing algorithm may assign an order to a courier who already has too many orders.

**Action:** Reroute the order to a more optimal courier. See `dispatch-strategy-balancing.md`.

### 3. Non-Optimal Routes

The algorithm may assign an order to a courier who is already going in the opposite direction.

**Action:** Reroute the order to a more optimal courier. If no better courier is available, adjust the order times to allow the one courier to handle both orders sequentially (rather than simultaneously in conflicting directions).

---

## Scenarios and Corrective Actions

### Scenario: Courier Going Long Distance in Multiple Directions

When courier resources are limited, a courier may be assigned multiple orders in opposite directions, leading to potential delays.

**Corrective actions:**
1. Modify order ready times as soon as possible to reduce potential delays
2. Ensure the courier delivers the closest orders first
3. Adjust market delay to ensure no new orders conflict with the courier's long-distance trip

### Scenario: Courier Delayed at Restaurant

Couriers are often delayed at restaurants. Delays under 10 minutes are expected and acceptable. Delays longer than 10 minutes can cascade into multiple future order issues.

**Corrective actions:**
1. Communicate with the courier to get an accurate ready time
2. Notify customers of the delay
3. Check the courier's next pickup — reroute it or adjust timing to reduce potential delays
4. If another pickup is required, have the courier leave the restaurant and come back (do not let them sit idle for 20+ minutes)

### Scenario: Courier Delayed at Customer

Couriers are occasionally delayed trying to find a customer or confirm delivery.

**Corrective actions:**
1. Communicate with the courier and help them find the customer
2. Attempt to reach the customer directly
3. Instruct the courier to take/send a photo and leave the order at the door
4. Notify the customer of the delivery with the photo

### Scenario: Order Late Pickup

When an order is late being picked up from the restaurant.

**Corrective actions:**
1. Determine how long the currently assigned courier is delayed
2. Attempt to reroute the order to a courier who can pick it up as soon as possible
3. Communicate with the courier to prioritize the late order
4. Notify the restaurant and customer via call and prefab message

---

## Route Optimization Principles

1. **Closest orders first.** When a courier has multiple deliveries, deliver the nearest one first. This maximizes freshness and minimizes total drive time.

2. **Do not backtrack.** A route that goes A -> B -> back past A -> C is worse than A -> C -> B (if B is past A). Always check the route on the map.

3. **Leave breathing room.** When predicting courier return times, add buffer for unexpected delays (traffic, customer not answering, restaurant slowness).

4. **The route must make sense.** This is the cardinal rule. No assignment — automated or manual — should stand if the route does not make geographical and temporal sense.

---

## Sisyphus Implementation

Routing monitoring runs as part of the continuous dispatch loop:

1. After each order confirmation, verify the routing algorithm's assignment is reasonable
2. Check the assigned courier's current location, existing orders, and direction of travel
3. If the assignment creates a conflict (opposite direction, overloaded courier, no Smart Serve for alcohol), flag for reroute
4. For reroutes: identify the optimal alternative courier using position, load, and timing data
5. Execute the reassignment and notify affected parties
6. Log all routing corrections in the shift audit trail
