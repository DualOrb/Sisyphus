---
agent: driver-comms
trigger: courier_picked_up_wrong_order
priority: high
version: "1.0"
---

# Process: Courier Picked Up Wrong Order

## Trigger

When a courier picks up the wrong food from a restaurant -- either the wrong order entirely or a bag meant for a different courier/customer.

Common triggers:
- Courier messages: "I think I grabbed the wrong order," "The bag has a different name on it," "Customer says this isn't their food"
- Customer reports receiving wrong items
- Restaurant reports a courier took the wrong bag

## Prerequisites

Before responding, gather context:
- [ ] `get_order_details(orderId)` -- the order the courier was supposed to pick up
- [ ] `query_orders({ driverId, status: ["Confirmed", "Ready", "EnRoute", "InBag", "InTransit"] })` -- all active orders for this courier
- [ ] `query_orders({ restaurantId, status: ["Confirmed", "Ready"] })` -- other orders at the same restaurant that may have been swapped
- [ ] `query_drivers({ driverId })` -- courier's current status and location
- [ ] Check if the courier had a **bundle** (multiple pickups) -- bundles increase the chance of a swap

**Key determination from the guide:**
- If the customer has the **correct order number** on the bag but **wrong items inside** = **restaurant error**
- If the customer has the **incorrect order number** on the bag and **wrong items inside** = **courier error**

## Step-by-Step Resolution

### Step 1: Confirm the Situation

Message or call the courier to confirm what happened:
> "Hi {firstName}, can you check the order number on the bag? What number is on it?"

Determine:
1. Which order did the courier actually pick up? (Check the order number on the bag)
2. Which order were they supposed to pick up?
3. Has the courier already delivered the wrong order, or do they still have it?
4. Was the courier doing a bundle (multiple pickups from the same or nearby restaurants)?

### Step 2: Identify Both Affected Orders

There are typically two affected orders:
- **Order A**: The order the courier picked up (wrong one)
- **Order B**: The order the courier should have picked up (still at restaurant or picked up by someone else)

Find both orders using the order numbers and the restaurant's active order list.

### Step 3: Immediate Courier Reassignment

Per the guide, two changes must be made:

1. **Change the courier on the order they picked up** (Order A)
   - The courier currently has Order A's food -- assign them as the courier for Order A so they can deliver it to the correct customer
   - Or, if another courier was already assigned to Order A, coordinate the swap

2. **Change the courier on the order they should have picked up** (Order B)
   - Order B's food is still at the restaurant (or was picked up by the courier who was supposed to get Order A)
   - Assign the appropriate courier to Order B, or assign a new available courier

**If the couriers were doing a bundle and swapped bags:**
- Swap the courier assignments on both orders so each courier delivers the food they actually have
- This is the fastest resolution if both couriers are still near each other or en route

**If only one courier is involved (grabbed wrong bag, correct one still at restaurant):**
- Determine if the courier can return to the restaurant to swap
- If the courier is already far from the restaurant, assign a new courier to pick up the correct order (Order B) from the restaurant
- The courier keeps and delivers the order they have (Order A) to that customer

### Step 4: Contact the Restaurant

Call or message the restaurant to:
1. Confirm Order B's food is still available and has not been taken
2. If Order B's food was taken by the wrong person, ask the restaurant to remake it
3. If a remake is needed, set up a re-dispatch:
   - If it was a **courier error**: enter the cost of the item being re-dispatched under "Valley Eats Owes Restaurant" so the restaurant is paid for the remake
   - If it was a **restaurant error** (wrong items in a correctly numbered bag): the restaurant covers the remake cost

### Step 5: Communicate with Affected Customers

**Customer receiving a late or re-dispatched order:**
> "We apologize for the delay with your order. There was a mix-up at the restaurant and we are getting your correct order to you as quickly as possible."

**Customer who already received the wrong food:**
1. Call the customer to confirm the order number on the bag (to determine fault)
2. Ask if they are alright with the food they received (if they received more food than ordered, they may be fine with it)
3. If they want the correct order:
   - Re-dispatch the correct order from the restaurant
   - Let them know: "We will have your correct order out to you as soon as possible. We apologize for the mix-up."
4. If they prefer a refund/credit instead of re-dispatch:
   - If courier error: process the refund immediately
   - If restaurant error: call the restaurant to confirm, then process

### Step 6: Process Re-Dispatch (if needed)

Follow the standard re-dispatch process:
1. Open the order, click "Order Corrections" in the top right
2. Set resolution to "Re-Dispatch"
3. Choose who is at fault (courier, restaurant, or Valley Eats)
4. Write in the description what is being dispatched (e.g., "Please prepare the original order -- courier picked up wrong bag")
5. If courier/Valley Eats error, enter the cost of the items under "Valley Eats Owes Restaurant"
6. Set a pickup time (10 minutes if the market is not busy; longer if busy)
7. Select the cause of the re-dispatch
8. After re-dispatching, ensure the order appears on the dispatch screen and is assigned to an on-shift driver

### Step 7: Document and Follow Up

1. Document: `execute_action("AddTicketNote", { note: "Courier {DriverId} picked up wrong order at {RestaurantName}. Order #{orderA} was taken instead of #{orderB}. Fault: {courier/restaurant}. Resolution: {courier swap / re-dispatch / refund}." })`

2. If courier error, select the appropriate driver error type in the order corrections dropdown

3. After a re-dispatch is delivered, **call the customer** to ensure they received the correct order and everything is alright -- this extra step makes the customer feel cared for

## Response Templates

**To courier -- confirming the situation:**
> "Hi {firstName}, can you check the order number on the bag? What number is on it?"

**To courier -- swap instructions:**
> "Hi {firstName}, it looks like you have order #{orderA} instead of #{orderB}. Please deliver the order you have to {Order A's address}. We're getting a courier to handle the other one."

**To courier -- return to restaurant:**
> "Hi {firstName}, you picked up the wrong order. Can you head back to {RestaurantName} to swap it? The correct order is still there."

**To customer -- delay due to mix-up:**
> "We apologize for the delay with your order. There was a mix-up at the restaurant and we are getting your correct order to you as quickly as possible."

**To customer -- already received wrong food:**
> "We're sorry about the mix-up with your order. Would you like us to send out the correct order, or would you prefer a refund?"

**To restaurant -- confirming correct order is available:**
> "Hi, one of our couriers picked up the wrong order. Is order #{orderB} still available for pickup?"

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `SendDriverMessage` | YELLOW | Instructing courier on swap or delivery change |
| `SendCustomerMessage` | YELLOW | Notifying customer of the mix-up and resolution |
| `ReassignOrder` | YELLOW | Changing courier assignments on affected orders |
| `AddTicketNote` | GREEN | Documenting the wrong pickup and resolution |
| `EscalateTicket` | GREEN | If re-dispatch involves significant cost or customer escalation |
| `request_clarification` | -- | Escalating to supervisor for complex multi-order swaps |

## Cooldown Rules

| Action | Minimum Wait | Max Attempts |
|--------|-------------|--------------|
| Courier communication | 0 (immediate) | -- |
| Customer notification | 0 (immediate) | 1 |
| Restaurant call | 0 (immediate) | 1 |
| Post-delivery follow-up call | After re-dispatch is delivered | 1 |

## Escalation

Escalate to supervisor if:
- Multiple orders are affected (chain of wrong pickups)
- The restaurant cannot remake the order (out of ingredients, closing soon)
- Customer is demanding significant compensation beyond standard authority
- Repeated courier error pattern -- create a courier ticket for relations@valleyeats.ca
- The wrong order contained allergens that could be a safety concern
