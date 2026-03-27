---
agent: supervisor
trigger: market_info_lookup
priority: normal
version: "1.0"
---

# Market Information Reference

**Trigger:** Need to read and interpret the dispatch market view.

**Check First:**
- Market tabs, delay values, and HUD squares

**Steps:**
1. **Market box:** shows current delay (auto-adjusted by Supervisor Bot -- time for courier to reach restaurant). Red box on market = unconfirmed order with pickup <15 min away. Red background = unconfirmed order within 11 min -- call the unconfirmed party.
2. **Driver squares (HUD):** Green=OK, Yellow=conflicting, Red=overloaded, Blue=empty, Black=off-shift. Numbers: top-left=orders, top-right=conflicts, bottom-right=late orders.
3. **ETA badges (below Ready/Delivery times):** green=on time, yellow=going to be late, red=will be late. Red box around order = 10+ min past pickup (serious -- get courier there, communicate to restaurant).
4. **Courier symbols:** orange vest=trainee (monitor closely, lighter loads). Beer emoji=Smart Serve (required for alcohol, keep available in market).
5. **Order symbols:** star=pre-order (utmost care for requested time). Eightball=future-date pre-order. Recycling=re-dispatch. Red/blue background=cross-market delivery.
6. **Key actions:** watch delay meter, act on red backgrounds, act on red boxes, balance HUD (move orders from Red/Yellow to Blue/Green), watch ETA badges, bundle cross-market orders.

**Escalate If:**
- Cannot resolve red-background or red-box situations with available couriers
