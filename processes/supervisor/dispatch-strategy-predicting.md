---
agent: supervisor
trigger: strategy_predicting
context: dispatching
priority: high
version: "1.0"
source: "Dispatch Analyst Guide — Dispatching Strategies: Predicting"
---

# Dispatch Strategy: Predicting

## Core Principle

Dispatching is the organization of couriers and orders to achieve an optimal number of orders delivered on time. The foundation of good dispatching is prediction — anticipating where couriers will be, when they will be available, and where problems will emerge before they happen.

---

## What Predicting Means

Continuously scan the order table to predict upcoming problems before they become actual delays. Prediction is proactive — you are looking 10-30 minutes into the future, not reacting to what already happened.

---

## How to Predict

### 1. Track Courier Position Over Time

By clicking the address under the "Customer" column of an order, the map navigates to the delivery destination. Use this to predict where the courier will end up at the end of that delivery.

From there, estimate:
- How long it will take them to return to the restaurant zone
- What orders are ready for pickup near their projected location
- Whether they can pick up another order on the way back

### 2. Use Ready and Delivery Times

By reading the "Ready" and "Delivery" times on the order table:
- Predict at what time the courier will be at the delivery location
- Using the time it took them to get there, predict how long it will take to get back
- Always leave breathing room in case something goes wrong

### 3. Monitor Pickup/Delivery Variance

The order table shows two critical variances:
- **Ready time vs. actual pickup time** — Is the courier arriving at the restaurant on time?
- **Estimated delivery time vs. actual delivery time** — Is the courier delivering on time?

By scanning these variances, you can see how a courier is performing in real time. If a courier's variances are growing (pickups getting later and later), their future orders will also be late.

### 4. Know Each Courier's Capabilities

Build a mental model of each courier:
- **Trainees (orange vest):** Do not send multiple orders at once. Monitor closely.
- **Experienced couriers:** Can handle bundles, longer routes, and tighter timing.
- **Fast drivers vs. slow drivers:** You will learn who your rockstars and slowpokes are. Use this knowledge to set realistic expectations for order timing.

This knowledge comes with time, but it is essential for accurate prediction.

### 5. Account for Restaurant Delays

Restaurants may be delayed during the night, which compounds a courier's subsequent late orders. When a restaurant is consistently late:
- Send couriers with spread-out orders (so a restaurant delay does not cascade)
- Call the restaurant to get an accurate ETA so you can have the courier come back at a later time instead of waiting

---

## When a Prediction Shows a Problem

When scanning reveals an upcoming issue, take immediate corrective action:

1. **Reroute future orders** — If a courier is falling behind, reassign their upcoming orders to a less busy courier before the problem gets worse
2. **Adjust pickup times** — Update ready times with accurate data from the courier or restaurant so the system reflects reality
3. **Reroute to a more optimal courier** — When an order is late to be picked up, find a less busy courier and send them to the restaurant immediately
4. **Communicate changes** — Notify the restaurant and/or customer of any adjustments to timing or courier assignment

---

## Prediction Indicators (Order Table Signals)

| Signal | Meaning | Action |
|--------|---------|--------|
| Green prediction boxes (below Ready/Delivery times) | On time | No action needed |
| Yellow prediction boxes | Going to be late to pickup/dropoff | Monitor; consider rerouting |
| Red prediction boxes | Will be late to pickup or dropoff | Immediate action — reroute or adjust times |
| Red background on market tab | Order within 11 min not confirmed by restaurant or courier | Call the unconfirmed party |
| Red box around an order | Order not picked up, 10+ min past pickup time | Critical — get a courier there immediately; communicate delays |
| Orange vest on courier name | Trainee (< 10 orders or repeated issues) | Monitor closely, do not overload |
| Beer emoji on courier name | Smart Serve certified | Required for alcohol orders — do not send them away from market |
| Star beside order | Pre-order — customer requested specific time | Highest priority for on-time delivery |
| Eightball beside order | Future-date pre-order | Advance planning required |
| Recycling symbol | Re-dispatched order (problem with original delivery) | Coordinate with market dispatcher on timing |

---

## Sisyphus Implementation

The prediction loop runs continuously as part of the market monitoring cycle:

1. Poll order table for variance trends (pickup and delivery time gaps)
2. Identify couriers whose variances are increasing — flag their future orders as at-risk
3. Check courier position vs. next pickup location — flag impossible or tight pickups
4. Cross-reference restaurant delay history — adjust expected ready times for chronically late restaurants
5. When a problem is predicted, trigger the appropriate corrective action (reroute, adjust time, notify)

The key metric is: **catch the problem before it becomes a delay the customer experiences.**
