---
agent: supervisor
trigger: scenario_late_pickup
priority: high
version: "1.0"
---

# Scenario: Order Late Pickup

**Source:** Dispatch Analyst Guide -- Scenarios section, Alerts/Symbols, Dispatching Strategies

---

## When This Happens

An order is ready at the restaurant but has not been picked up by a courier. This could be because the assigned courier is delayed, overloaded, or unresponsive. A red box appears around the order when it has not been picked up and is more than 10 minutes past its pickup time.

---

## Key Indicators

- **Red box around the order:** The order has not been picked up and it is more than 10 minutes past its pickup time. The box goes away once the driver marks it "In Bag." This is a serious issue.
- **Red background on market tab:** An order within the next 11 minutes has either not been confirmed by the restaurant or the courier has not confirmed on their end. Call whichever party is having the issue.
- **Yellow/Red prediction boxes:** Below the Ready and Delivery times, these predict whether pickup/delivery will be on time. Yellow = going to be late. Red = will be late.
- **"Placed" status lingering:** The order has not been confirmed by the restaurant. If the order is within 10 minutes of pickup without restaurant confirmation, call the restaurant.

---

## Procedure

### Step 1: Determine How Long the Currently Assigned Courier Is Delayed

- Check the order table to see the courier's current status, location, and remaining orders.
- Use the map to see where the courier is relative to the restaurant.
- Use the "Ready" and "Delivery" times to estimate when the courier can realistically arrive.
- Check the courier utilization display: Red = overloaded, Yellow = conflicting orders.

### Step 2: Attempt to Reroute the Order

- If the assigned courier cannot pick up the order soon, reroute it to a courier who can pick it up as soon as possible.
- To reroute: click the courier's 2-character moniker on the dispatch view. Select another active courier, click "anyone else" (auto-assigns to an available driver, avoiding the current one), or "surprise me" (system picks the best option).
- An order can be rerouted at any point before the courier marks "At Restaurant."
- When rerouting, scan for empty couriers (Blue on the utilization display) or couriers with capacity (Green).
- When scanning the order table, look for couriers finishing deliveries within 10-15 minutes who have no orders after -- they can likely take an order to lessen the load.

### Step 3: Communicate with the Courier to Prioritize the Late Order

- If rerouting is not possible, contact the currently assigned courier.
- Instruct them to prioritize this pickup over less urgent tasks.
- A phone call is more effective than a text when the courier is driving.

### Step 4: Notify the Restaurant and Customer

- **Restaurant:** Call the restaurant to communicate the delay. If we do not communicate delays, we will almost certainly have to cover the cost of a remake. Let them know when to expect the courier.
- **Customer:** Send a prefab notification and/or call the customer to explain the delay. Use: "Our apologies for the delay, your order will be on its way shortly."
- Every communication should be noted in the order's dispatcher notes.

---

## If No Courier Is Available

If no scheduled courier can pick up the order:

1. **Send a driver push notification** to request on-call couriers:
   - Go to the driver page, select the market.
   - Click "Message," choose target group (available, scheduled, etc.).
   - Choose SNS (app notification, less urgent) or SMS (text message, urgent).
   - Example SMS: "If anyone is available to jump on call right now, please do so and let dispatch know. Thank you!"
   - Example urgent SMS: "URGENT! We are urgently looking for a driver to hop on in [market]. If you are available please reach out to dispatch! Thank you"
2. **Ask couriers finishing shifts** if they can stay on longer (they are not obligated as independent contractors, but often help if asked nicely).
3. Wait 15-20 minutes for couriers to respond before escalating to the driver relations team.

---

## Preventing Late Pickups

### Proactive Monitoring

- Continuously scan the order table to predict upcoming problems.
- Be aware of courier loads and tardiness -- reroute future orders before they become late.
- By clicking a customer's address, you can predict where a courier will end up after a delivery and plan accordingly.

### Bundling Late Orders

- If an order is already delayed, new bundling opportunities may open up that were not available before. Look for orders going to the same area or from the same restaurant.

### Unresponsive Driver Tickets

- The system automatically generates an "unresponsive driver" ticket when a driver is not confirming orders and pauses them.
- Message and then call the driver. If they respond and are available, unpause them.
- An "unresponsive only driver" ticket means the only driver in the market is not confirming -- this is extremely urgent. Message and call immediately.

---

## Escalation

- If delays persist despite all adjustments, consult your supervisor.
- The supervisor may decide to move the market to "Takeout Only" as a last resort to focus on clearing current orders.
- Moving to Takeout Only slows sales, risks accidental takeout orders customers cannot pick up, and makes recovery difficult -- avoid this if possible.
