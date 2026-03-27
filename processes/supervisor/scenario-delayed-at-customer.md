---
agent: supervisor
trigger: scenario_delayed_customer
priority: high
version: "1.0"
---

# Scenario: Courier Delayed at Customer

**Trigger:** Courier is stuck at customer location (no unit number, customer not answering, address hard to find).

**Check First:**
- Delivery address, instructions, and customer profile Background notes
- Courier's other active orders (delay impacts them too)

**Steps:**
1. Communicate with courier to understand the issue (no unit number, no answer, wrong address).
2. If no unit number: check past orders for unit number, message customer to meet at main entrance.
3. If customer not answering: message customer, then call. Use 4 contact circles on dispatch for quick access.
4. If still unresponsive: instruct courier to leave order at door, take photo with address visible, mark delivered.
5. Notify customer of delivery with photo reference.
6. Check courier's upcoming orders -- if delay is extending, reroute next orders to available courier to prevent cascade.
7. After resolution, update customer account delivery instructions for future orders.

**Escalate If:**
- Alcohol order and customer unreachable (cannot leave at door)
- Courier feels unsafe
- Address is genuinely invalid
