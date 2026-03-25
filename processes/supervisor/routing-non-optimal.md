---
agent: supervisor
trigger: routing_non_optimal
priority: high
version: "1.0"
---

# Routing: Non-Optimal Routes

**Source:** Dispatch Analyst Guide -- Routing section, Dispatching Strategies, Bundling, Predicting

---

## What It Means

Orders may be assigned to couriers who are already going in opposite directions. The routing algorithm makes a best attempt at assigning an order to the most optimal courier, but like any software, sometimes things fail. When a courier is sent on a route that does not make geographic or logistical sense, delays are inevitable.

---

## How to Identify Non-Optimal Routes

### Map Review

- Click the address under the "Customer" column of an order to navigate the map to the delivery location.
- Review all orders assigned to a single courier and check whether the pickup and delivery locations form a logical path.
- Look for couriers being sent in opposite directions or zigzagging across the market.

### Order Table Scanning

- Continuously scan the order table to predict upcoming problems.
- Check the variance between ready time and actual pickup time -- growing gaps indicate route problems.
- Check the variance between estimated delivery time and actual delivery time.
- When an order is late to be picked up, investigate whether the courier's route is the cause.

### Courier Utilization Display

- Yellow status on a courier indicates potentially conflicting orders -- investigate whether the conflict is a route issue.
- Planned bundles you created may show as yellow (conflict). This is acceptable if the routes genuinely make sense.

### Peer Review

- Asking a supervisor or colleague to review your current courier routes is valuable. With high order volume, it is hard to keep track, so a sanity check from someone else works well.

---

## Procedure: Fixing Non-Optimal Routes

### Option 1: Reroute the Order to a More Optimal Courier

- If a courier has been assigned an order that sends them in the wrong direction, reroute it to a courier who is closer or heading that way.
- To reroute: click the courier's 2-character moniker on the dispatch view. Select another active courier, click "anyone else," or click "surprise me."
- Target couriers who are Green (OK) or Blue (empty) on the utilization display.
- An order can be rerouted at any point before the courier marks "At Restaurant."
- If the courier is already en route, call them directly to redirect -- do not rely on app notifications.

### Option 2: Adjust Order Times

- Sometimes rerouting is not possible (e.g., only one courier available). In this case, adjust the order ready times to allow the courier to complete deliveries sequentially.
- Only modify ready times if you have an accurate update from the restaurant and/or courier.
- If the change is greater than 10 minutes, call the restaurant with as much notice as possible.
- When possible, adjust ready times earlier rather than delaying them.
- Ensure the restaurant has not already started preparing the order for the original time.

### Option 3: Adjust Delivery Sequence

- Instruct the courier on the optimal sequence for their pickups and deliveries.
- Closest deliveries first to maintain food freshness and reduce backtracking.
- Use the map to determine which orders are on the way and which require detours.
- Communicate the plan clearly to the courier.

---

## Route Evaluation Criteria

A good route should follow these principles:

1. **Pickups and deliveries flow geographically** -- no backtracking or zigzagging.
2. **Closest deliveries first** -- ensures maximum freshness.
3. **Restaurants are close together** if the courier has multiple pickups.
4. **Minimal wait time between pickups** -- no more than 5 minutes gap. If the gap is larger, ask the restaurant to have orders ready at the same time.
5. **Cross-market deliveries have a return plan** -- if a courier goes from Pembroke to Petawawa, try to give them a return trip or local orders in the destination market.
6. **At all costs, the route must make sense.**

---

## Bundling to Optimize Routes

When you spot a non-optimal route, look for bundling opportunities that create a better path:

### From the Same Restaurant
1. Assign orders from the same restaurant to one courier if the route is acceptable and pickup times are within 5-10 minutes.
2. Communicate the plan with the courier.
3. Notify the restaurant of order groupings so they have all orders ready together.

### To the Same Address
1. Assign orders for the same customer to one courier if the route is acceptable within pickup times.
2. Adjust pickup times with restaurants if possible to allow one-courier bundling.
3. Communicate the plan with the courier.

### To the Same Area
1. Assign orders being delivered to the same zone to one courier if the route is acceptable within pickup times. This is especially important for cross-market orders (e.g., Pembroke and Petawawa).
2. Adjust pickup times with restaurants if possible.
3. Communicate the plan with the courier.

---

## Proactive Route Monitoring

### Predicting Strategy

- Continuously scan the order table to spot route issues before they cause delays.
- Be aware of courier loads and tardiness -- reroute future orders before they become problems.
- Adjust pickup times with updated, accurate data.
- Communicate any changes with restaurant and/or customer.

### Running Behind Checklist

If non-optimal routes have caused your market to fall behind:

1. Look for couriers that will be available within 10-15 minutes (finishing a delivery with no orders after).
2. Try to bundle late orders -- delays may open new bundling opportunities.
3. Send a push for on-call couriers.
4. Review time views to find order clusters and redistribute timing.
5. Re-evaluate current delays and adjust market delay settings as needed.

Repeat these steps until the load is manageable.

---

## Escalation

- If routes cannot be fixed due to insufficient couriers, request additional coverage through driver pushes or the driver relations team.
- If the delivery radius is the root cause of non-optimal routes (orders too far apart for available couriers), notify a supervisor -- only supervisors can adjust the delivery radius.
- As a last resort, a supervisor may move the market to "Takeout Only" to clear the backlog.
