---
agent: supervisor
trigger: routing_unassigned
priority: high
version: "1.0"
---

# Routing: Unassigned Couriers

**Source:** Dispatch Analyst Guide -- Routing section, Balancing, Dispatching Strategies

---

## How Auto-Assignment Works

Orders are automatically assigned to a courier when confirmed by the restaurant, handled by the supervisor bot. The routing algorithm makes a best attempt at assigning an order to the most optimal courier, but sometimes things fail.

As a dispatcher, part of your role is to monitor the assignment of orders and implement corrective measures when things go wrong.

---

## Why Orders Go Unassigned

Confirmed orders may not be assigned a courier for several reasons:

1. **No courier scheduled** -- There is no active courier in the market.
2. **Alcohol order with no Smart Serve courier** -- Orders containing alcohol can only be assigned to couriers who have their Smart Serve certification (Ontario law). If no Smart Serve courier is available, the order remains unassigned.
3. **A bug in the system** -- The routing algorithm may occasionally fail.

---

## Procedure

### For All Cases: Assign the Order Manually

- Open the order, scroll down to below the Courier Instructions, and click the box labeled "assign a driver" to select an available courier.
- Alternatively, on the dispatch view, click the courier moniker area on the order and select from the dropdown of active couriers.
- You can also click "anyone else" (auto-assigns to an available driver) or "surprise me" (system picks the best option).

### Case 1: No Courier Scheduled

1. Check if any couriers are finishing shifts soon or are on-call.
2. Send a driver push notification to request coverage:
   - Go to the driver page, select the market.
   - Click "Message," choose target group.
   - Use SNS (app notification) for moderate urgency or SMS (text) for urgent needs.
   - Example: "If anyone is available to jump on call right now, please do so and let dispatch know. Thank you!"
3. Ask couriers ending shifts if they can extend (they are independent contractors and not obligated, but often willing if asked nicely).
4. Wait 15-20 minutes for a response before contacting the driver relations team.
5. If the market truly has no coverage, consult your supervisor about reducing the delivery radius or moving to "Takeout Only."

### Case 2: Alcohol Order Without Smart Serve Courier

1. Check the courier utilization display for any Smart Serve certified couriers (indicated by a beer cup emoji on their name).
2. Make sure you have enough Smart Serve couriers in the market and avoid sending them away on long-distance trips.
3. If no Smart Serve courier is available, you may need to cancel the order -- you cannot legally have a non-certified courier deliver alcohol.
4. Communicate with the customer about the situation.

### Case 3: System Bug

1. Manually assign the order to an appropriate courier.
2. Create a ticket for Dan documenting the issue (order ID, market, time, what happened).

---

## Proactively Using Empty Couriers

The courier utilization heads-up display shows courier status:

- **Blue = empty courier** (no current orders)
- **Green = OK** (manageable load)
- **Yellow = conflicting orders** (potential issues)
- **Red = overloaded** (too many orders)
- **Black = off shift** (15 min before start or 30 min after end)

### When You See an Empty Courier (Blue)

1. Scan the order table for orders that can be rerouted to this courier.
2. Look for upcoming orders that could benefit from being assigned to them.
3. Consider bundling opportunities:
   - **Same restaurant:** Assign orders from the same restaurant if pickup times are within 5-10 minutes.
   - **Same address:** Assign orders for the same customer if route is acceptable.
   - **Same area:** Assign orders being delivered to the same zone (especially important for cross-market deliveries like Pembroke/Petawawa).

### When Running Behind

1. Look for couriers that will be available within the next 10-15 minutes (finishing a delivery with no orders after).
2. Try to bundle late orders -- delays may create new bundling opportunities.
3. Send a push for on-call couriers.
4. Review time views to see when the most orders are concentrated and adjust timing to spread the load.

---

## Key Principle

An idle courier is a missed opportunity. Continuously monitor the utilization display and proactively assign work to empty or underutilized couriers. Do not wait for the system to catch up -- manual intervention keeps the market running on time.
