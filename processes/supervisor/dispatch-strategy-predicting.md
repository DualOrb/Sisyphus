---
agent: supervisor
trigger: strategy_predicting
context: dispatching
priority: high
version: "1.0"
source: "Dispatch Analyst Guide — Dispatching Strategies: Predicting"
---

# Dispatch Strategy: Predicting

**Trigger:** Continuous proactive monitoring -- look 10-30 minutes ahead to catch problems before they become delays.

**Check First:**
- Order table variances (ready time vs actual pickup, estimated vs actual delivery)
- Courier positions and projected destinations

**Steps:**
1. **Track courier position over time:** click customer address to see where courier ends up after delivery. Estimate return time. Plan next order based on where they WILL be, not where they are.
2. **Use ready/delivery times:** predict when courier will be free, how long to get back. Always leave breathing room.
3. **Monitor variance trends:** growing gaps between estimated and actual times = courier falling behind = their future orders will also be late.
4. **Know courier capabilities:** trainees (orange vest) = single orders, close monitoring. Experienced = can handle bundles and tighter timing. Learn who is fast vs slow.
5. **Account for restaurant delays:** chronically late restaurants = spread out courier orders to prevent cascade. Call for accurate ETA instead of letting courier wait.
6. **When prediction shows a problem:** reroute future orders to less-busy courier, adjust pickup times with accurate data, communicate changes to restaurant/customer.
7. **Prediction indicators:** green boxes = on time. Yellow = going to be late (monitor, consider rerouting). Red = will be late (immediate action). Red box on order = 10+ min past pickup (critical). Star = pre-order (highest priority for on-time).

**Escalate If:**
- Multiple couriers' variances growing simultaneously (systemic issue)
- Cannot find corrective action due to insufficient couriers
