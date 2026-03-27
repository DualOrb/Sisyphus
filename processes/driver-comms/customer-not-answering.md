---
agent: driver-comms
trigger: customer_not_responding_at_door
priority: normal
version: "1.0"
---

# Customer Not Responding to Door

**Trigger:** Courier reports customer is not answering the door, not coming out, or appears not home.

**Check First:**
- DeliveryType ("Leave at door" vs "Hand delivered")
- DeliveryInstructions (alternate contact, buzzer codes)
- Whether order contains alcohol (Alcohol field)

**Steps:**
1. **"Leave at door" orders:** tell courier to leave at door, take photo with address visible. Notify customer of delivery. Done.
2. **"Hand delivered" orders:** message customer ("Courier is at your location with your order"). If no response in 1-2 min, call customer (try twice).
3. Tell courier to wait 5 minutes total from first contact attempt while messaging and calling customer.
4. If customer still unresponsive after 5 min: instruct courier to leave order at door, take photo with address visible. Notify customer the order was left.
5. Document: courier arrived, customer unresponsive after message + call + 5-min wait, order left at door with photo.
6. **Alcohol orders: CANNOT be left unattended.** Follow steps 1-3, then escalate to supervisor. Do NOT instruct courier to leave at door. Message courier that you are escalating.

**Escalate If:**
- Alcohol order and customer unreachable after 5 minutes
- Courier feels unsafe at delivery location (immediate SAFETY escalation)
- Delivery address appears invalid or suspicious
- Customer later disputes delivery and photo evidence is inconclusive
