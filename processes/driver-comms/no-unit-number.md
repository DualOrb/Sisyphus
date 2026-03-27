---
agent: driver-comms
trigger: delivery_missing_unit_number
priority: normal
version: "1.0"
---

# No Unit Number on Delivery Address

**Trigger:** Courier reports no unit/apartment number on a delivery to a multi-unit building.

**Check First:**
- DeliveryInstructions (unit number may be embedded there)
- Customer past orders to same address for a previously used unit number
- Customer profile saved addresses
- Whether order contains alcohol

**Steps:**
1. Check DeliveryInstructions and past orders for unit number. If found, relay to courier and update order.
2. If not found, message customer asking them to meet courier at main entrance. If no response in 2 min, call customer (try twice).
3. If customer provides unit number: update delivery instructions, send ping to courier, relay unit number.
4. If customer unresponsive after 5 min: check DeliveryType. "Leave at door" or "Hand delivered" -- instruct courier to leave at main entrance, take photo with address visible. Notify customer.
5. After resolution, update customer's saved address with unit number for future orders. Document interaction.
6. **Alcohol orders: CANNOT be left unattended.** If customer unreachable, escalate to supervisor immediately. Do NOT instruct courier to leave at door.

**Escalate If:**
- Alcohol order and customer is unreachable
- Courier feels unsafe at delivery location
- Conflicting or suspicious address information
- Courier waiting >10 minutes with no resolution
