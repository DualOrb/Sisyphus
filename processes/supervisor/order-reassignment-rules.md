---
agent: supervisor
trigger: reassignment_consideration
priority: critical
version: "1.0"
---

# Order Reassignment Rules

## NEVER Reassign These Statuses

Orders in **InBag** or **InTransit** must NEVER be reassigned unless catastrophic:

| Status | Can Reassign? | Why |
|--------|--------------|-----|
| Placed | ✅ Yes | No driver has committed yet |
| Confirmed | ✅ Yes | Driver assigned but hasn't picked up |
| Ready | ✅ Yes (with caution) | Food is ready, driver may be en route |
| EnRoute | ⚠️ Only if driver hasn't arrived | Driver heading to restaurant |
| InBag | ❌ NO | Driver has the food physically |
| InTransit | ❌ NO | Driver is delivering to customer |

### The Only Exception: Catastrophic Failure

Reassign InBag/InTransit ONLY if:
- Driver's vehicle broke down and they physically cannot continue
- Driver had a medical emergency
- There is an **arranged pass-off** with another driver at a meeting point

Even then, this requires human dispatcher approval (RED tier).

## What To Do Instead for Late InBag/InTransit Orders

1. **SendDriverMessage** — check on the driver: "Hey [name], how's the delivery going? Need any help?"
2. **Wait 2-3 minutes** for response
3. If no response → **call the driver** (escalate to human dispatcher for phone call)
4. If still no response after 5 minutes → **EscalateTicket** to human dispatcher
5. Check the driver's GPS/location if available — are they moving?

## Diagnosing Late Orders

Before blaming the driver, check the order timeline:

1. `OrderPlacedTime` → `DeliveryConfirmedTime`: Was the **restaurant** slow to confirm?
2. `DeliveryConfirmedTime` → `OrderReadyTime`: Did the **restaurant** take too long to prepare?
3. `OrderReadyTime` → `OrderInBagTime`: Did the **driver** take too long to pick up?
4. `OrderInBagTime` → `OrderInTransitTime`: Normal transition (seconds)
5. `OrderInTransitTime` → now: Is the **driver** taking too long to deliver?

If steps 1-2 show the restaurant was late, the driver is doing their best. Don't flag the driver.
Only flag the driver if steps 3-5 show unusual delays AND they're not responding to messages.

## Alcohol Orders

- Only orders with `Alcohol: true` flag require Smart Serve certified drivers
- A restaurant being a pub/bar does NOT mean the order has alcohol
- The dispatch system already prevents assigning alcohol orders to non-certified drivers
- Do NOT suggest reassignment based on restaurant type — check the order's Alcohol flag

## Order Leaving Dispatch = Delivered

When an order disappears from the dispatch board (dispatch.txt), it means:
- The order was **delivered** and completed, OR
- The order was **cancelled**

This is normal. Do NOT flag it as an issue or suggest investigation.
