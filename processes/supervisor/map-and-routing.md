---
agent: supervisor
trigger: map_review
priority: normal
version: "1.0"
---

# Map and Routing -- Using Map Information for Dispatch Decisions

> Source: Dispatch Analyst Guide -- Map Functions, Addresses, Dispatching Guide, Routing, Dispatching Strategies

## Map Overview

The Dispatch screen shows a map with all orders displayed as colored pins and all restaurants displayed with their logos at their locations. Each courier appears on the map with their 2-character moniker.

### Navigating the Map

- Click on a customer's address in the "Customer" column to navigate the map to the delivery location.
- This lets you predict where the courier will end up after completing that delivery.
- Restaurant monikers appear on the map at their physical location with their logo.

## Address Pin Colors

| Pin Color | Meaning |
|---|---|
| **Green** | Order is on track, on time, no conflicts |
| **Red** | Order is late and needs attention. If 10+ minutes late, a red box also appears around the order. |

## Cross-Market Visual Indicators

Orders with a **red and blue background** on the dispatch/order panel are cross-market deliveries (e.g., Pembroke to Petawawa, Carleton Place to Almonte).

Dispatch implications:
- Bundle cross-market orders as much as possible to avoid losing too many couriers from the home market.
- Plan return trips (e.g., after a Pembroke-to-Petawawa delivery, give them a Petawawa-to-Pembroke order).
- Or give them several local orders in the destination market to justify the deadhead drive back.
- Never give a single courier more than 3 in-bag orders at once (food quality risk).

## Checking Delivery Range

To verify whether an address is within delivery range:

1. Look up the address on **wego.here.com** (the mapping system used in the app) or Google Maps.
2. Enable a view of the **market radius** on the dispatch map.
3. Check if the address falls within the radius circles.

### Address Troubleshooting

Address errors are common because HERE Maps and Google Maps may use different address formats. Example: a customer enters "206 County Road 29, Smiths Falls" but HERE Maps shows it as "206 CR-29, Rideau Lakes."

- Use wego.here.com to find the HERE-equivalent address.
- Try different address formats in the order modal until the pin appears at the correct location.
- Always confirm with the customer that the pin is in the correct location.
- Update the address in their account so it works correctly for future orders.

## How to Change a Customer's Address on an Order

1. Open the order.
2. Click **Modify Order**.
3. Input the new address.
4. Click all **"Geolocate"** and **"Calculate"** options (this recalculates delivery costs).
5. If an error occurs, open a new tab and try again.
6. Write a reason for the change in the **"Modify Notes"** section.
7. **Confirm the new address marker is in the correct location on the map.**
8. If the order is already In Transit, **call the driver** to confirm they received the updated address so they do not misdeliver.

### Payment Method Limitations

- If a customer used Apple Pay, Android Pay, or Google Pay, an error will occur because we cannot charge them for the extra delivery fee.
- For Android Pay or Google Pay address changes, Valley Eats absorbs the cost (it is cheaper than canceling the order and paying the restaurant for wasted food).

## Spotting Problems Visually on the Map

### Problem: Courier Going in Wrong Direction

Look at the map to see where a courier currently is versus where their orders are. If they are heading away from their next pickup:
- The routing may be non-optimal.
- Reroute the order to a courier with a better path.
- Sometimes this is unavoidable -- adjust order times to allow the one courier to complete all orders.

### Problem: Red Pins Clustering

Multiple red pins in one area indicate a concentration of late orders. This signals:
- A restaurant may be slow (call for accurate ETAs).
- A courier may be stuck or overloaded.
- You may need to reroute orders to other couriers or send an empty courier to that area.

### Problem: Couriers Spread Too Thin

If couriers are scattered across the map with long distances between them and upcoming orders:
- Look for couriers finishing deliveries near the problem area.
- Bundle orders to consolidate trips.
- Send a push notification for on-call couriers.
- Consider adjusting the delivery radius (supervisor only).

### Problem: Cross-Market Orders Pulling Couriers Away

Watch for couriers being sent to distant markets. Each cross-market delivery removes a courier from the home market for an extended period.
- Check if there are return orders to send them back with.
- Monitor the home market HUD for the impact (turning red/yellow as capacity drops).

## Using the Map for Route Planning

### Predicting Courier Position

1. Click the delivery address of a courier's current order to see where they are heading.
2. Use the Ready and Delivery times to estimate when they will be done.
3. Factor in return travel time (add breathing room for unexpected delays).
4. Assign their next order based on where they will be, not where they are now.

### Evaluating Bundle Routes

When bundling orders for one courier:
- Verify on the map that delivery addresses are near each other or that one is on the way to the other.
- Ensure restaurant locations are close together.
- Deliver closest orders first, then furthest -- minimizes freshness loss and backtracking.
- The route must always make sense visually on the map.

### Delivery Fee and Distance

Delivery fees are calculated from restaurant to customer using the fastest route from HERE location services:
- **$4.00 base fee**
- **$0.61/km** base range
- **$0.80/km** extended range (after initial 5 km)
- Varies by market

## Routing Failures to Watch For

| Failure | How to Spot | Fix |
|---|---|---|
| **Unassigned order** | Order confirmed but no courier moniker shown | Assign manually. If it is a bug, create a ticket for Dan. |
| **Overloaded courier** | Red on HUD; many orders stacked on one driver on the map | Reroute orders to green/blue couriers |
| **Non-optimal route** | Courier going in opposite directions on the map; delivery paths zigzagging | Reroute to a courier with a straighter path; adjust times if rerouting is not possible |
| **Courier in wrong market** | Courier pin is far from their home market | Plan return trip orders or local orders in the destination market |

## Map Legend and Help

New symbols and markers may be added to the map over time. To see a legend of all current symbols, click the **help icon** (question mark) on the top left of the dispatch screen.
