---
agent: driver-comms
trigger: courier_will_be_late
priority: normal
version: "1.0"
---

# Courier Running Late

**Trigger:** Courier reports they will be late to pickup or delivery, or dispatch detects courier is behind schedule.

**Check First:**
- get_entity_timeline for the driver AND the order — see what messages/actions were already taken and when
- Order timestamps: ReadyTime, DeliveryTime (includes auto 5-min buffer), AtRestaurantTime, PickedUpTime
- Courier's current status and all active orders
- Whether courier has bundled orders causing the delay
- If driver was already messaged <5 min ago, do NOT re-message — wait for response per timing rules below

**Steps:**
1. **Late to restaurant pickup:** assess delay length. Message the driver to confirm ETA. ALSO message the restaurant via SendDriverMessage to the restaurant contact — let them know the driver is running late so they can manage food timing (hold prep, keep food warm). If food is ready and waiting, this is more urgent. If delay >10 min and another courier is available closer, reroute the order.
2. **Late to customer delivery:** if moderate delay, notify customer. If order is "In Bag" approaching delivery time, customer sees ETA auto-updating. 10+ min past delivery time = red status, needs immediate attention.
3. **Courier with multiple orders:** ensure closest deliveries first. Do NOT put multiple orders In Transit to separate locations simultaneously (customer sees courier driving away from them).
4. **Courier delayed at restaurant 10+ min:** get accurate ready time from courier. Notify customers. Check next pickup — reroute or adjust. If courier has another pickup elsewhere, have them leave and come back.
5. **Significant delays (10-15+ min):** prepare for complaints. Service fee credits $5-$10 for moderate delays. Larger compensation requires supervisor approval.

**Timing Rules (respect cooldowns):**
- First message to driver: immediately when late detected
- Second message: wait at least 5 min after first (per cooldown)
- Third message: wait at least 5 min after second — then escalate if no response
- If get_entity_timeline shows a message was sent recently, calculate time elapsed before deciding to message again

**Escalate If:**
- Delay >30 min requiring significant compensation
- Multiple orders cascading into delays due to courier shortage
- Customer upset and requesting management
- Courier unresponsive while orders delayed
- Food quality compromised, re-dispatch may be needed (confirm with supervisor)
