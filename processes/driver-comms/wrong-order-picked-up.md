---
agent: driver-comms
trigger: courier_picked_up_wrong_order
priority: high
version: "1.0"
---

# Courier Picked Up Wrong Order

**Trigger:** Courier picks up wrong food from restaurant -- wrong bag, bag swap, or customer reports wrong items.

**Check First:**
- Order the courier was supposed to pick up
- All active orders for this courier (bundles increase swap risk)
- Other orders at same restaurant that may have been swapped
- Key: correct order number on bag but wrong items = restaurant error. Wrong order number on bag = courier error.

**Steps:**
1. Confirm situation: ask courier to check order number on bag. Determine which order they have vs. should have. Are there two affected orders (swap)?
2. Identify both affected orders (Order A = what they have, Order B = what they should have).
3. **If bag swap between couriers:** swap courier assignments on both orders so each delivers what they have. Fastest resolution.
4. **If single courier grabbed wrong bag:** determine if they can return to swap. If too far, assign new courier for Order B. Current courier delivers Order A to that customer.
5. Contact restaurant: confirm Order B's food is still available. If taken or needs remake: courier error = enter cost under "Valley Eats Owes Restaurant." Restaurant error = restaurant covers remake.
6. Communicate with affected customers. Offer re-dispatch or refund/credit (customer choice).
7. Process re-dispatch if needed: Order Corrections > Re-Dispatch, choose fault, set pickup time (10 min if not busy), select cause/error type.
8. After re-dispatch delivered, call customer to confirm correct order received.

**Escalate If:**
- Multiple orders affected (chain of wrong pickups)
- Restaurant cannot remake (out of ingredients, closing)
- Customer demanding significant compensation beyond standard authority
- Repeated courier error pattern (ticket for relations@valleyeats.ca)
- Wrong order contained allergens (safety concern)
