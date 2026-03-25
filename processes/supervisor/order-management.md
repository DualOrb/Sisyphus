---
agent: supervisor
trigger: order_status_change
priority: high
version: "1.0"
---

# Order Management -- Status Progression and Intervention

> Source: Dispatch Analyst Guide -- Order Information, Adjusting a courier on an order, Alerts/Symbols/Pings, Order Re-Dispatch, Dispatching Guide

## Order Types

An order is either:

- **Delivery** -- we deliver it to the customer.
- **Takeout** -- the customer picks it up at the restaurant.

## Order Fields in Dispatch

Each order in the Orders tab displays:

| Field | Description |
|---|---|
| **ID** | Unique 8-digit hexadecimal identifier (characters 0-9, a-f, g). If a customer says "o", it is a zero. Click to open detailed view. Can also search by order ID in the search bar. |
| **Courier** | 2-character moniker identifying the assigned courier (unique within a market, not globally). |
| **Address** | Customer delivery address. Clicking it navigates the map to that location. |
| **Ready Time** | Time the driver should arrive at the restaurant. |
| **Delivery Time** | Estimated time the order will be delivered to the customer. System automatically adds 5 minutes to each order ETA to account for small delays. |
| **Status** | Current state of the order (see progression below). |

## Quick Contact

Each order shows 4 contact circles on the dispatch page:

- For a **driver**: circles appear above their 2-digit moniker.
- For a **restaurant**: circles appear above the restaurant name.
- For a **customer**: circles appear above their address.
- Inside the order page, circles appear above each party's full name.

## Status Progression

Orders progress through these statuses. A timestamp appears once each status is set by the driver or dispatch.

### 1. Placed

- Order has not been confirmed by the restaurant.
- **Intervention trigger**: Call the restaurant if the order is within 10 minutes of pickup without restaurant confirmation.
- If credits were used: customer has been charged credits (returned if canceled).
- If card payment: payment is authorized but not captured (hold appears on card).

### 2. Confirmed (Restaurant Only)

- Restaurant has confirmed the order, but the courier has not yet confirmed.

### 3. Confirmed (Both)

- Both the courier and the restaurant have confirmed the order.

### 4. En-Route

- Courier is on the way to the restaurant.
- **Key behaviors**:
  - Sends a notification to the restaurant with courier ETA. Some restaurants (fast food) wait for this notification before starting preparation.
  - Courier must go directly to the restaurant after selecting this status.
  - Prevents the courier from selecting another order as En-Route unless it is to the same restaurant.
- **Do not switch orders from a courier at this status** unless necessary. If you must, call the courier about the swap.
- A dispatcher can clear this status by clicking the green X if needed.

### 5. Ready

- Set by the restaurant when food is prepared.
- If **Takeout**: customer is notified their order is ready.
- If **Delivery**: courier is notified the food is ready; a timestamp records when exactly.

### 6. At Restaurant

- Set by the dispatcher using "Set" buttons on the order information section (sets to current time).
- Timestamps are useful for determining whether food quality complaints are our fault or not.
- **Monitoring rule**: If a courier marks "At Restaurant" more than 5 minutes before pickup time, reach out and ask them not to arrive too early. If they are only sitting outside waiting, clear this status -- that is not what it is for.

### 7. In Bag

- Courier has received the order; it is in their bag but not yet in transit.
- A "Picked-Up" timestamp appears showing how long after arriving the courier received the food.
- If the order is not put In Transit within 5 minutes, a "pending delivery" status triggers for the customer.

### 8. In Transit

- Customer is notified food is on the way.
- Customer can now view the driver's location from their app.
- **Important**: Do not have multiple orders in transit simultaneously if they are going to separate locations -- the customer will see the driver going in the wrong direction.

### 9. Delivered / Completed

- Order is finished and delivered to the customer.

### 10. Canceled

- Customer is informed the order is canceled for a specific reason.
- Automatic refund is processed; restaurant will not be paid.
- **Mandatory step**: Call the restaurant FIRST to confirm they have not started making the order. If they already started, tell the customer we cannot cancel.
- Restaurants can also decline an order and provide a reason, which processes a cancellation.

## When to Intervene

| Condition | Action |
|---|---|
| Order within 10 min of pickup, restaurant has not confirmed | Call the restaurant to confirm |
| Red market background (unconfirmed order within 11 min) | Call whichever party (restaurant or courier) has not confirmed |
| Red box around order (10+ min past pickup, not "In Bag") | Urgently ensure a courier gets there; communicate delay to restaurant; reroute if needed |
| Yellow ETA badge | Warning -- check if the courier can still make it; consider rerouting |
| Red ETA badge | Order will be late -- reroute to faster courier or adjust times |
| Courier at restaurant within 5 min of delivery time | Send a ping to customer informing them of restaurant delay |
| Order "In Bag" approaching delivery time | Customer sees ETA auto-updating; if they write in, let them know the order is on its way |
| Courier marked "At Restaurant" 5+ min before pickup time | Contact courier; ask them not to arrive too early; clear status if they are just waiting outside |
| Multiple orders "In Transit" to different locations for one courier | Ensure only one is In Transit at a time so customers do not see confusing driver movement |

## Modifying Ready Time

The ready time can be changed by:

1. Clicking the time itself and adding +/- time (in minutes), OR
2. Opening the order directly and manually editing the pickup time.

**Rules for modifying ready time**:

- Only modify if the driver has been updated by the restaurant with an accurate ETA.
- Only modify if the restaurant has provided an accurate ETA.
- Only modify if the driver will not make the initial time AND you have an accurate update AND the restaurant has not started preparing the order.
- If the change is greater than 10 minutes, call the restaurant with as much notice as possible -- they may have already started preparing.

## Order Re-Dispatch

A re-dispatch sends food back out from the restaurant to be redelivered.

### Prerequisites

1. Customer wants the food sent back out (not just a credit).
2. Customer is available to receive the redelivery.
3. Restaurant is still open and makes the food.
4. We have enough available drivers; if there will be a delay, inform the customer before re-dispatching.
5. The order must be marked "Completed" and be from today's date.

### Procedure

1. Open the order by clicking the order ID.
2. Click **Order Corrections** in the top right.
3. Set resolution to **Re-dispatch**.
4. Choose who is at fault (courier, restaurant, or Valley Eats).
5. Write what is being dispatched in the description (e.g., "Please prepare the missing medium fries, thank you!").
6. If Valley Eats/courier fault, enter the cost of the item to pay the restaurant for the remake.
7. Set a pickup time (10 min if market is not busy; later if busy).
8. Select the cause and error type.
9. The original driver is auto-assigned due to familiarity with the customer's location; may be rerouted for efficiency.

### After Re-Dispatch

- Verify the order appears on dispatch and is assigned to an active driver (the original driver may be off-shift).
- Call the customer after redelivery to confirm everything is correct.

### Canceling a Re-Dispatch

- Click the green X, set order status to "Completed."
- This ensures the 1st courier gets paid, and the 2nd courier is not paid (they still receive the delivery fee but no tip).
- If funds for a remake need to go to the restaurant, use "Valley Eats Owes Restaurant."

## Cross-Market Orders

Orders with a red/blue background in dispatch are cross-market deliveries (e.g., Pembroke to Petawawa, Carleton Place to Almonte).

- Bundle these as much as possible to avoid losing too many couriers from the home market.
- Try to plan a return trip (e.g., if courier does Pembroke-to-Petawawa, give them a Petawawa-to-Pembroke order on return).
- Or give them a few local orders in the destination market to make the drive back worthwhile.
- Avoid giving any single courier more than 3 in-bag orders at once -- this affects food quality.
