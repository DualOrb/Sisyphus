---
agent: driver-comms
trigger: courier_overloaded
priority: high
version: "1.0"
---

# Process: Courier Overloaded

## Trigger

When a courier has too many orders assigned and is unable to complete them all within acceptable timeframes, or when dispatch detects a courier's workload is causing delivery delays.

Common triggers:
- Courier messages: "I have too many orders," "I can't do all of these," "I'm overwhelmed"
- Dispatch notices a courier has 3+ in-bag orders simultaneously
- Multiple orders for one courier are turning red (late) on the dispatch screen
- Courier is going long distances in multiple directions with bundled orders
- Courier is delayed at one stop and subsequent orders are cascading into delays

## Prerequisites

Before responding, gather context:
- [ ] `query_orders({ driverId, status: ["Confirmed", "Ready", "EnRoute", "InBag", "InTransit"] })` -- all active orders for this courier
- [ ] `query_drivers({ driverId })` -- courier's current location, status, and zone
- [ ] `get_order_details(orderId)` for each active order -- check `ReadyTime`, `DeliveryTime`, `DeliveryStreet`, `RestaurantName`, timestamps
- [ ] `query_drivers({ dispatchZone, available: true })` -- available couriers in the same zone for potential reassignment
- [ ] Review the map for the courier's route -- are deliveries in the same area or spread across different directions?

**Key rule from the guide:**
> Avoid giving any single courier more than **three (3) in-bag orders at one time**, as this may affect food quality if food is held in-bag for too long.

## Detection

### Signs of an Overloaded Courier

1. **Three or more in-bag orders** at the same time
2. **Orders turning red** (late by 10+ minutes) on the dispatch screen -- a red box appears around late orders
3. **Courier is within 5 minutes of delivery time** and still at a restaurant
4. **Multiple deliveries going in opposite directions** -- the courier cannot deliver efficiently
5. **Courier is delayed at a restaurant** for 10+ minutes and has other orders waiting
6. **Courier reports being overwhelmed** or unable to complete assignments

### Good Bundle vs. Overloaded

**Good bundle** (acceptable):
- Delivery addresses are near each other or one is on the way to the other
- Restaurants are close together
- Minimal time between pickups (less than 5 minutes)
- Route makes logical sense -- closest deliveries first

**Overloaded** (needs intervention):
- Deliveries going in opposite directions
- More than 3 in-bag orders
- Delay between pickups greater than 5 minutes (food sitting too long)
- Route does not make sense geographically
- Courier cannot reach all delivery times

## Step-by-Step Resolution

### Step 1: Assess the Route

Review all active orders for the courier and determine the most efficient route:
1. Map out all pickup and delivery locations
2. Identify which deliveries are closest and should be done first
3. Identify orders that are going in a completely different direction and causing inefficiency
4. Check which orders are closest to their delivery time (most urgent)

### Step 2: Communicate the Optimal Route

If the orders are manageable but the courier needs routing help:

> "Hi {firstName}, here's the best route for your orders: deliver to {address 1} first (closest), then {address 2}, then {address 3}. Let me know if you need anything."

**Routing principles:**
- Deliver closest orders first to ensure maximum freshness and less backtracking
- If courier is going from one market to another (e.g., Pembroke to Petawawa), try to plan a return trip or local orders in the second market to make it worth the drive back
- Cross-market deliveries should be bundled as much as possible to avoid losing couriers to deadhead trips

### Step 3: Reassign Orders That Cannot Be Completed

If the courier truly cannot handle all assigned orders:

1. **Identify which order(s) to move** -- prioritize removing orders that:
   - Are furthest from the courier's current route
   - Have the most flexible delivery times
   - Are going in the opposite direction from the majority of the courier's deliveries
   - Have not been picked up yet (easier to reassign before pickup)

2. **Find an available courier** for the reassigned order(s):
   - Check `query_drivers({ dispatchZone, available: true })` for available couriers
   - Prefer couriers who are closer to the restaurant for the reassigned order
   - Ensure the new courier is not also overloaded

3. **Change the courier on the order**: `execute_action("ReassignOrder", { orderId, newDriverId, reason: "Original courier overloaded" })`

4. **Notify the original courier:**
   > "Hi {firstName}, I've moved order #{orderId} to another courier to lighten your load. Focus on delivering to {remaining addresses}."

5. **Notify the new courier** (if needed -- they should receive the assignment automatically, but a heads-up helps):
   > "Hi {firstName}, I've assigned order #{orderId} to you from {RestaurantName}. Pickup at {readyTime}. Thanks!"

### Step 4: Adjust Ready Times with Restaurants

If the courier is keeping some orders but will be late to pickups:

1. **Modify pickup times** to align with the courier's realistic arrival
   - Call the restaurant to confirm they can adjust
   - Ask the restaurant to have orders ready for the same time if the courier is doing multiple pickups at nearby restaurants
   - If a delay between bundled orders is greater than 5 minutes, ask the restaurant to hold or delay preparation so the courier is not waiting with old food

2. **Adjust the market delay** if needed to prevent new orders from conflicting with the overloaded courier's route

3. Message the restaurant with updated ETA:
   > "Our courier is delayed, should be there in {estimated_minutes}."

### Step 5: Notify Affected Customers

For customers whose orders will be delayed due to the overload:

> "Our apologies for the delay, your order will be on its way shortly."

If the delay is significant:
> "We apologize for the delay with your delivery tonight. We are currently experiencing higher than normal volumes of orders. We always communicate with the restaurant to ensure your order is as fresh as possible."

If a customer's order is within 5 minutes of delivery time and the courier is still at a restaurant, send a proactive notification about the restaurant delay.

### Step 6: Prevent Future Overloading

After resolving the immediate situation:

1. **Review bundle decisions** -- were the bundles logical?
   - Were delivery addresses near each other?
   - Were restaurants close together?
   - Was the time between pickups less than 5 minutes?
   - Did the route make sense?

2. **Monitor the courier** for the rest of the shift to ensure the workload stays manageable

3. **Communicate delays proactively** with restaurants if the courier is still overloaded -- take action to prevent this before it happens

4. If courier resources are limited for the market, consider whether the **delivery radius** needs to be reduced (supervisor-only action):
   - Fewer available couriers = consider reducing the market's delivery radius
   - Ensure a notice is displayed in the app: "Delivery only available up to {X}km from {market}. Our apologies for the inconvenience!"

## Response Templates

**To courier -- providing optimal route:**
> "Hi {firstName}, here's the best route for your orders: deliver to {address 1} first, then {address 2}, then {address 3}."

**To courier -- reassigning an order:**
> "Hi {firstName}, I've moved order #{orderId} to another courier to lighten your load. Focus on delivering to {remaining addresses}."

**To courier -- acknowledging they're busy:**
> "Hi {firstName}, I can see you've got a lot going on. Let me help sort out the best route and see if I can move any orders."

**To customer -- delay notification:**
> "Our apologies for the delay, your order will be on its way shortly."

**To restaurant -- updated courier ETA:**
> "Our courier is delayed, should be there in {estimated_minutes}."

**To new courier -- reassigned order:**
> "Hi {firstName}, I've assigned order #{orderId} to you from {RestaurantName}. Pickup at {readyTime}. Thanks!"

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `SendDriverMessage` | YELLOW | Route guidance, reassignment notifications |
| `SendCustomerMessage` | YELLOW | Delay notifications to affected customers |
| `SendRestaurantMessage` | YELLOW | Updated ETAs for delayed pickups |
| `ReassignOrder` | YELLOW | Moving orders to available couriers |
| `AddTicketNote` | GREEN | Documenting overload situation and actions taken |
| `request_clarification` | -- | Escalating to supervisor for delivery radius changes or courier shortages |

## Cooldown Rules

| Action | Minimum Wait | Max Attempts |
|--------|-------------|--------------|
| Route communication to courier | 0 (immediate) | -- |
| Order reassignment | 0 (immediate) | As many as needed |
| Customer delay notification | 0 (immediate) | 1 per customer per delay event |
| Restaurant ETA update | 0 (immediate) | Update again only if ETA changes |

## Escalation

Escalate to supervisor if:
- No available couriers in the zone to take reassigned orders -- courier shortage situation
- Delivery radius may need to be reduced (supervisor-only action)
- Multiple couriers across the market are overloaded simultaneously -- systemic issue
- Courier is upset, frustrated, or threatening to stop working mid-shift
- Food quality has been compromised on multiple orders and re-dispatches or refunds are needed
- Courier has been working extended hours and may need to be asked to pause (shift/scheduling matter -- outside dispatch authority)
