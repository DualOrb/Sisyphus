---
agent: supervisor
trigger: scenario_delayed_restaurant
priority: high
version: "1.0"
---

# Scenario: Courier Delayed at Restaurant

**Source:** Dispatch Analyst Guide -- Scenarios section, Courier Support, Order Statuses

---

## When This Happens

Couriers are often delayed at restaurants. While some delays are expected and acceptable, delays longer than 10 minutes can lead to several future order issues -- cascading late deliveries, food quality problems, and potential remake costs.

---

## Key Indicators

- **"At Restaurant" status timestamp:** If a courier has been marked "At Restaurant" for an extended period, investigate. Couriers should only mark this status when they are physically inside the restaurant waiting for food.
- **Red box around an order:** Appears when an order has not been picked up and it is more than 10 minutes past its pickup time. This is a serious issue.
- **Yellow/Red prediction boxes:** The boxes below Ready and Delivery times predict when pickup and delivery will happen. Yellow = going to be late. Red = will be late.
- **"At Restaurant" too early:** If a courier marks "At Restaurant" more than 5 minutes before the pickup time, reach out and ask them not to arrive too early. If they are just sitting outside waiting, clear this status -- that is not what it is used for.

---

## Procedure

### Step 1: Communicate with the Courier

- Message or call the courier to get an accurate ready time from the restaurant.
- Ask: How long has the restaurant said it will take? Is the food being prepared?
- A quick call is often better than texting, especially if the courier is driving or inside the restaurant.

### Step 2: Notify Customers of the Delay

- If the courier is still at a restaurant within 5 minutes of the estimated delivery time, send a ping to the customer informing them the restaurant is delayed.
- Use the prefab message: "Our apologies for the delay, your order will be on its way shortly."
- If the delay is significant, call the customer directly.

### Step 3: Check the Courier's Next Pickup and Reroute or Adjust

- Review the courier's upcoming orders in the order table.
- If the delay will cause the courier to be late for their next pickup, either:
  - **Reroute the next order** to a less busy courier.
  - **Adjust the ready time** on the next order if the restaurant has not yet started preparing it (notify the restaurant of the time change).
- Only modify order ready times if you have an accurate update from the restaurant and/or courier.
- If the ready time change is greater than 10 minutes, call the restaurant with as much notice as possible.

### Step 4: Have the Courier Leave if Another Pickup Is Required

- If the courier has another pickup that is time-sensitive, instruct them to leave the delayed restaurant and handle the other pickup first.
- Reroute the delayed order to another available courier, or adjust its ready time.
- When moving an order from a courier who is already en route, call them to let them know so they can redirect immediately.

---

## Preventing Restaurant Delays

### Identify Consistently Late Restaurants

- If a restaurant is consistently late, try to assign couriers with well-spread-out orders so a restaurant delay does not cascade.
- Call the restaurant to get an accurate ETA, so you can have the courier arrive at a later time instead of waiting.
- Restaurant delays during peak/night hours will accumulate across a courier's subsequent orders -- proactive management is critical.

### Bundling Considerations

- When bundling orders, ensure there is minimal time between pickups. If there is a delay between orders of greater than 5 minutes, ask the restaurant to have the orders ready for the same time.
- Do not let a courier wait 20 minutes with food in their bag just to pick up another order.

---

## Red Box (10+ Minutes Past Pickup) -- Urgent Action

When a red box appears around an order (10+ minutes past pickup time):

1. This is a serious issue. Try at all costs to ensure a courier is there soon.
2. Communicate the delays with the restaurant -- if we do not, we will almost certainly have to cover the cost of a remake.
3. Reroute the order if needed to minimize time.
4. The red box disappears once the driver marks the order "In Bag."

---

## Communication Templates

- **To restaurant (courier running late):** "Courier is delayed, should be there in ___."
- **To customer (order delayed):** "Our apologies for the delay, your order will be on its way shortly."
- **Ping to customer (near delivery time):** Send a prefab notification that the restaurant is delayed.

---

## Escalation

- If restaurant delays are chronic, document the pattern and escalate to the restaurant support team.
- If you cannot resolve the delay and the order is significantly late, consult your supervisor for next steps (credit, cancellation, or remake).
