---
agent: supervisor
trigger: market_info_lookup
priority: normal
version: "1.0"
---

# Market Information Reference

> Source: Dispatch Analyst Guide -- Dispatch Navigation > Market Information, Alerts/Symbols/Pings, Dispatching Strategies > Balancing

## Opening the Market View

When you first open Dispatch, you see a map and tabs for each city we service (called **Markets**). Each market appears as a clickable tab.

- Click the **X** in the corner of a market tab to remove it from view (like closing a browser tab).
- Drag and drop tabs to rearrange them in an order that suits your current shift.
- Access additional navigation (drivers, restaurants, schedules) via the **three horizontal lines** in the top right corner.

## What Each Market Box Shows

Each market box displays:

| Element | Meaning |
|---|---|
| **Delay value** | The current delay in the market -- the amount of time given for a courier to arrive at a restaurant to receive an order. This is automatically adjusted by the Supervisor Bot. It does not affect restaurant-side delay. |
| **Red box on a market** | A restaurant or courier has NOT confirmed an order with a pickup fewer than 15 minutes away. This is a warning to take action immediately. |
| **Red background on market** | An order within the next 11 minutes has either not been confirmed by a restaurant, or a courier has not confirmed the order on their end. Action: call whichever party is having the issue and have them confirm the order. Be mindful of how long they have had the order -- if it was just placed or just assigned, calling too soon can annoy them. |

## Driver Squares (Courier Utilization Heads-Up Display)

The small squares at the bottom of each market represent drivers. Their color indicates status:

| Color | Meaning |
|---|---|
| **Green** | OK courier -- operating normally, manageable load |
| **Yellow** | Courier with potentially conflicting orders |
| **Red** | Overloaded courier -- too many orders assigned |
| **Blue** | Empty courier -- no orders currently assigned |
| **Black** | Off-shift courier (within 15 min before shift start, or within 30 min after shift end) |

Each driver square also displays:

| Position | Meaning |
|---|---|
| **Top-left number** | Number of orders the courier currently has |
| **Top-right number** | Number of conflicting orders the courier has |
| **Bottom-right number** | Number of late orders the courier has |

### How to Use the HUD

- When you see a **blue** (empty) courier, scan the order table for orders that can be rerouted to them.
- When you see a **red** (overloaded) courier, assign their orders to couriers that are green or blue to mitigate delays.
- **Yellow** may be acceptable if it is a planned bundle you created yourself -- verify the route makes sense.

## ETA Badges (Prediction Boxes)

Below the **Ready Time** and **Delivery Time** on each order, there are colored prediction boxes that indicate/predict when the order will be picked up and delivered:

| Badge Color | Meaning |
|---|---|
| **Green** | On track -- pickup and delivery will be on time |
| **Yellow** | Warning -- going to be late to pickup or drop-off |
| **Red** | Late -- will be late to pick up or drop off the order |

A **red box around an entire order** means the order has not been picked up from the restaurant and it is more than 10 minutes past its pickup time. The box disappears when the driver marks "In Bag." This is a serious issue:

- Ensure a courier gets there soon.
- Communicate the delay to the restaurant.
- Reroute if needed to minimize time.
- Failure to act will almost certainly require covering the cost of a food remake.

## Courier Status Symbols

| Symbol | Meaning |
|---|---|
| **Orange safety vest** on courier name | Courier in training (fewer than 10 orders, or has had repeated issues). Monitor closely and check in that things are going OK. |
| **Beer cup emoji** on courier name | Courier has Smart Serve certification. Only these couriers can deliver orders containing alcohol (Ontario law). Ensure you have enough Smart Serve couriers in the market before sending them away. |

## Order Symbols

| Symbol | Meaning |
|---|---|
| **Star** beside order | Pre-order -- customer specifically requested this time. Take utmost care to fulfill the requested time. |
| **Eight-ball** beside order | Future-date pre-order (e.g., Thanksgiving). Customer reserved their meal days in advance. |
| **Recycling symbol** beside order | Re-dispatched order -- was already delivered but had a problem, so it was sent back out. Check the order for reasoning. |
| **Red/blue background** on order | Cross-market delivery (e.g., Pembroke to Petawawa, Carleton Place to Almonte). Bundle these as much as possible to avoid losing too many couriers. Try to plan a return trip. |

New symbols may be added from time to time. Refer to the **help icon** (question mark) on the top left of the dispatch screen for a legend of all current symbols.

## Delivery Fee Calculation Reference

- **$4.00 base fee**
- **$0.61/km** base range
- **$0.80/km** extended range (after the original 5km)
- Varies by market
- Calculated based on the fastest route from HERE location services (restaurant to customer)

## Key Monitoring Actions

1. **Watch the delay meter** -- it is auto-adjusted by the Supervisor Bot but understand what it means for courier arrival times.
2. **Watch for red market backgrounds** -- unconfirmed orders within 11 minutes need immediate action.
3. **Watch for red boxes on orders** -- orders 10+ minutes past pickup need urgent rerouting.
4. **Balance the HUD** -- keep drivers green, move orders off red/yellow drivers onto blue/green ones.
5. **Watch ETA badges** -- yellow badges are a warning; red badges require intervention before they become late orders.
6. **Track cross-market orders** -- red/blue background orders need bundling strategy to preserve courier availability.
