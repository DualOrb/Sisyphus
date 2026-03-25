---
agent: supervisor
trigger: routing_overloaded
priority: high
version: "1.0"
---

# Routing: Overloaded Drivers

**Source:** Dispatch Analyst Guide -- Routing section, Courier Overloaded, Balancing, Bundling

---

## What It Means

Orders may be assigned to couriers who already have too much on their plate. An overloaded courier leads to cascading delays: late pickups, late deliveries, cold food, unhappy customers, and potential remake costs.

---

## How to Identify Overloaded Couriers

### Courier Utilization Heads-Up Display

The utilization display provides at-a-glance courier status:

- **Red = overloaded courier** -- Too many orders, immediate action needed.
- **Yellow = conflicting orders** -- Potential timing issues between assigned orders.
- **Green = OK courier** -- Manageable workload.
- **Blue = empty courier** -- No current orders, available for assignment.
- **Black = off shift** -- Not currently active.

The display also shows:
- **Top left number:** Total orders assigned to the courier.
- **Top right number:** Number of conflicting orders.
- **Bottom right number:** Number of late orders.

### Order Table Scanning

- Scan the order table to see how a courier is performing based on pickup and delivery time variances.
- The variance between ready time and actual pickup time reveals if a courier is falling behind.
- The variance between estimated delivery time and actual delivery time shows cumulative delays.

---

## Procedure: When a Courier Is Overloaded

### Step 1: Find the Most Efficient Route

- Review the courier's assigned orders and determine the most efficient route.
- Communicate the optimal route to the courier so they know the best sequence for pickups and deliveries.
- Deliver closest orders first to maximize freshness and minimize backtracking.

### Step 2: Reroute Excess Orders

- If the courier cannot complete all assigned orders on time, reroute order(s) to a more optimal courier.
- To reroute: click the courier's 2-character moniker, select another active courier from the dropdown, or click "anyone else" or "surprise me."
- Target couriers who are not overloaded (Green) or empty (Blue) on the utilization display.
- An order can be rerouted at any point before the courier marks "At Restaurant."

### Step 3: Communicate Changes

- If you move an order from a courier who is already en route to a restaurant, call them to let them know and redirect them. Do not rely on app notifications alone -- the courier may not check their phone while driving.
- Notify the restaurant if pickup times change.
- Notify the customer if delivery times are affected.

---

## When to Redistribute Orders

Redistribute when any of the following are true:

- A courier shows Red on the utilization display.
- A courier has conflicting orders (Yellow) that cannot be resolved with time adjustments.
- A courier's late order count is climbing (bottom right number on the display).
- The courier themselves messages you saying the orders are unmanageable.
- Orders are being assigned to a courier going in opposite directions (see also: routing-non-optimal.md).

---

## How to Decide Which Orders to Move

1. **Move orders that have not started** -- Orders the courier has not marked "En Route" or "At Restaurant" are easiest to reroute.
2. **Move the order that causes the most conflict** -- If one order sends the courier far from the others, that is the one to move.
3. **Keep bundles intact** -- If a courier has well-bundled orders (same restaurant, same area), keep those and move the outlier.
4. **Consider pickup times** -- Move orders with later pickup times, as there is more time to reassign them.
5. **Avoid moving orders after "At Restaurant"** -- Once a courier is at the restaurant and waiting for an order, it is generally better to let them complete that pickup.

---

## Preventing Overload

### Maximum In-Bag Orders

- Avoid giving any single courier more than three (3) in-bag orders at one time. More than this affects food quality.

### Balancing

- Check courier utilization regularly and spread orders to multiple couriers to reduce overutilization.
- Assign new orders to couriers that are Green or Blue, not to those already Yellow or Red.

### Bundling Rules

Only bundle orders when all three conditions are met:
1. Delivery addresses are near each other, or one is on the way to the other.
2. Restaurants are close together, so picking up multiple deliveries does not cause delays.
3. Minimal time between pickups (less than 5 minutes). If the gap is greater than 5 minutes, ask the restaurant to have orders ready at the same time.

Planned bundles may show up as conflicts (yellow background). Ensure the routes make sense for the courier -- at all costs, **the route must make sense.**

### Courier Capabilities

- Know each courier's capabilities. Trainees (orange vest icon) should not receive multiple orders at once.
- Some couriers are faster and more efficient than others. Use this knowledge when deciding who can handle more.

---

## Communication with Overloaded Couriers

- Couriers may message you when their orders look unmanageable. Always acknowledge their concern -- even a quick "looking into it" or a thumbs up lets them know you saw their message.
- If a courier feels they cannot handle an order, try to move it to a different courier. This prevents stress and avoidable mistakes.
- Do not speak to couriers in an accusatory way. If a courier is being difficult, keep your cool and escalate to the driver relations team if needed.

---

## Escalation

- If all couriers in a market are overloaded, send a driver push for additional on-call couriers.
- Ask couriers finishing shifts if they can extend.
- If the situation does not improve after 15-20 minutes, contact the driver relations team.
- As a last resort, consult your supervisor about moving to "Takeout Only."
