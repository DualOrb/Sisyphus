---
agent: supervisor
trigger: reassignment_consideration
priority: critical
version: "1.0"
---

# Order Reassignment Rules

**Trigger:** Considering reassigning an order to a different driver.

**Check First:**
- Current order status (determines whether reassignment is allowed)
- Order timeline to diagnose who caused the delay

**Steps:**
1. **Reassignment allowed:** Placed (yes), Confirmed (yes), Ready (yes, with caution), EnRoute (only if driver hasn't arrived).
2. **NEVER reassign InBag or InTransit** unless catastrophic (vehicle breakdown, medical emergency, arranged pass-off). Even then, requires human dispatcher approval (RED tier).
3. **For late InBag/InTransit orders:** send driver message checking on them > wait 2-3 min > if no response, call driver > if still no response after 5 min, escalate to human dispatcher. Check GPS -- are they moving?
4. **Diagnose before blaming driver:** check timeline: OrderPlacedTime to DeliveryConfirmedTime (restaurant slow to confirm?), DeliveryConfirmedTime to OrderReadyTime (restaurant slow to prepare?), OrderReadyTime to OrderInBagTime (driver slow to pick up?), OrderInBagTime to OrderInTransitTime (should be seconds), OrderInTransitTime to now (driver slow to deliver?). If restaurant was late, don't flag the driver.
5. **Alcohol orders:** only Alcohol:true flag matters, not restaurant type. System prevents assigning to non-Smart Serve drivers. Do NOT suggest reassignment based on restaurant being a pub/bar.
6. **Order leaving dispatch = delivered or cancelled.** This is normal, not an issue.

**Escalate If:**
- Need to reassign InBag/InTransit (catastrophic only, human approval required)
- Driver unresponsive during active delivery (safety concern)
