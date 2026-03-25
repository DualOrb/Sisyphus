---
agent: supervisor
trigger: driver_assignment
priority: high
version: "1.0"
---

# Driver Assignment and Reassignment

> Source: Dispatch Analyst Guide -- Adjusting a courier on an order, Routing, Dispatching Strategies, Scenarios

## How Automatic Assignment Works

Orders are automatically assigned to a courier when confirmed by the restaurant, via the **Supervisor Bot**. The routing algorithm attempts to assign orders to the most optimal courier, but it sometimes fails.

As a dispatcher, your role is to **monitor assignments and implement corrective measures** when things go wrong.

## Courier Identification

Each courier in a market has a **2-character moniker** (unique within the market, not globally). This moniker appears on dispatch, on order rows, and on the map.

## How to Manually Assign a Driver

### Method 1: From the Order Detail

1. Open the order (click the order ID).
2. Scroll down to below the Courier Instructions section.
3. In the box labeled **"assign a driver"**, click and select a driver.

### Method 2: From the Dispatch Channel

1. Click on the courier's 2-character moniker on the order row.
2. A dropdown box appears showing available couriers.
3. Select a different courier's moniker to assign them, OR:
   - Click **"anyone else"** -- the system auto-assigns to another available/active driver and avoids sending it back to the current driver.
   - Click **"surprise me"** -- the system finds the best option, but it may send it back to the current driver. If that happens, use "anyone else" or pick a specific driver.

## When to Reassign a Driver

| Situation | Action |
|---|---|
| **Courier requests removal** | Courier does not want to deliver the order or something came up. Move the order. |
| **Major delay** | Courier is significantly behind and another courier is closer/faster. Reroute. |
| **Closer courier available** | A different courier will deliver the order quicker. Reroute. |
| **Overloaded courier** (red on HUD) | Too many orders on one driver. Move orders to green or blue couriers. |
| **Non-optimal route** | Courier is going in opposite directions. Reroute to a courier with a better path. |
| **Unassigned order** | Confirmed order has no courier (no courier scheduled, no Smart Serve for alcohol order, or system bug). Assign manually. For bugs, create a ticket for Dan. |
| **Courier En-Route but swap is necessary** | Call the courier to inform them of the swap. Do not silently reroute after En-Route status. |
| **Order late pickup** (red box, 10+ min past ready time) | Find a less busy courier and send them immediately. |
| **Courier delayed at restaurant 10+ min** | Check their next pickup; reroute future orders or adjust times to reduce cascading delays. |

## Decision Criteria for Choosing a Driver

When selecting which courier to assign or reassign, consider:

### 1. Distance and Location

- Where is the courier right now? Click the customer address to see where the order goes, then assess which courier will be nearest.
- Use the map to predict where a courier will end up after their current delivery.
- Use ready/delivery times to estimate when a courier will be free.

### 2. Current Load (HUD Colors)

- **Blue** (empty) -- preferred for new assignments.
- **Green** (OK) -- can take more orders.
- **Yellow** (conflicting) -- acceptable only if you have verified the route makes sense (e.g., a planned bundle).
- **Red** (overloaded) -- do NOT add more orders; move orders away.
- **Black** (off shift) -- not available.

Check the numbers: order count (top-left), conflict count (top-right), late order count (bottom-right).

### 3. Courier Capability

- **Trainee couriers** (orange vest icon) -- do not assign multiple orders at once. Monitor closely.
- **Smart Serve couriers** (beer cup emoji) -- required for alcohol orders per Ontario law. Do not send all Smart Serve couriers out of the market.
- Know each courier's speed and efficiency. Some are fast, some are slow. This knowledge comes with time.

### 4. Cross-Market Considerations

- Cross-market orders (red/blue background) pull couriers out of their home market.
- Bundle cross-market orders to minimize courier loss.
- Plan return trips so couriers are not deadheading back empty.
- Maximum 3 in-bag orders per courier to preserve food quality.

### 5. Bundling Opportunities

Assign multiple orders to one courier when:

- **Same restaurant**: pickup times within 5-10 minutes, route is acceptable.
- **Same customer address**: adjust pickup times if needed for one-courier bundling.
- **Same delivery area**: orders going to the same zone (critical for inter-town routes like Pembroke/Petawawa).

Bundling rules:
- Delivery addresses must be near each other, or one on the way to the other.
- Restaurants must be close together to avoid pickup delays.
- Time between pickups should be minimal (under 5 min). If longer, ask the restaurant to have orders ready at the same time.
- Deliver closest orders first for maximum freshness and less backtracking.
- Planned bundles may show as yellow (conflict) on the HUD. Verify the route makes sense -- the route must always make sense.

### 6. Restaurant Behavior

- If a restaurant is consistently late, assign a courier with spread-out orders so a restaurant delay is not critical.
- Call the restaurant for an accurate ETA so the courier can come at a better time.

## Communication Requirements

| Action | Communication Required |
|---|---|
| Moving an order from a courier who is En-Route | **Call the courier** to inform them and redirect them. Do not just silently reroute. |
| Bundling orders for a courier | Communicate the plan with the courier. Notify restaurants of order groupings so they prepare everything together. |
| Adjusting ready times | Notify the restaurant. If change is 10+ minutes, call with as much notice as possible. |
| Rerouting for late pickup | Communicate with the courier to prioritize the late order. Notify restaurant and customer. |
| Courier delayed at restaurant | Get accurate ready time from courier. Notify customers of delay. Check next pickup and reroute or adjust. |
| Courier delayed at customer | Help courier find customer. Attempt to reach customer. Instruct courier to photo and leave at door if needed. |

## When Running Behind -- Recovery Steps

1. Look for couriers available within 10-15 minutes (finishing a delivery with no orders after).
2. Bundle late orders -- delays may open new bundling possibilities.
3. Send a push notification for on-call couriers in the market.
4. Review time views -- delay or advance orders to balance the load.
5. Re-evaluate market delays and set as needed. Avoid hitting "Stop" to maximize profitability.
6. Ask a supervisor or colleague for a route sanity check.
7. If past maximum delay, a supervisor may move the market to "Takeout Only" (last resort -- slows sales and is hard to recover from).

## Reducing Delivery Radius

When available couriers are too few to service the regular market radius:

- Reduce the delivery radius (supervisor only).
- Display a notice in the app: e.g., "Delivery only available up to 10km from Perth. Our apologies for the inconvenience!"

## Scenarios Reference

### Courier Going Long Distance in Multiple Directions

1. Modify order ready times as soon as possible.
2. Ensure courier delivers closest orders first.
3. Adjust market delay to prevent conflicts with the long-distance trip.

### Courier Delayed at Restaurant (10+ min)

1. Communicate with courier for accurate ready time.
2. Notify customers of delay.
3. Check courier's next pickup -- reroute or adjust to reduce cascading delays.
4. Have courier leave the restaurant if another pickup is required.

### Courier Delayed at Customer

1. Help courier find the customer.
2. Attempt to reach the customer directly.
3. Instruct courier to take/send a photo and leave the order at the door.
4. Notify the customer of the delivery with the photo.

### Order Late Pickup

1. Determine how long the current courier is delayed.
2. Attempt to reroute to a courier who can pick up immediately.
3. Communicate with courier to prioritize the late order.
4. Notify restaurant and customer via call and prefab message.
