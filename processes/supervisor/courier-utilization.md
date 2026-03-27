---
agent: supervisor
trigger: utilization_check
context: dispatching
priority: high
version: "1.0"
source: "Dispatch Analyst Guide — Courier Utilization Heads Up Display"
---

# Courier Utilization HUD Reference

**Trigger:** Continuous monitoring of courier workload via the HUD at the bottom of each market tab.

**Check First:**
- Color of each courier tile and the three numbers on each

**Steps:**
1. **Colors:** Red = overloaded (reroute orders away immediately). Yellow = potentially conflicting (verify if planned bundle or real conflict). Green = OK (can accept more). Blue = empty (assign orders immediately). Black = off-shift (do not assign).
2. **Numbers:** top-left = total orders. Top-right = conflict count (2+ = investigate immediately). Bottom-right = late order count (2+ = reroute upcoming orders).
3. **Healthy market:** mostly Green, few Yellow (planned bundles), no Red, few Blue during peaks.
4. **Imbalanced market (most actionable):** Red and Blue simultaneously = orders need moving from Red to Blue. This is a distribution failure, not capacity.
5. **Rebalancing:** identify overloaded (Red) couriers' orders that haven't started. Find available (Blue/Green) couriers near the restaurant. Reassign. Communicate changes to both couriers.
6. **Special indicators:** orange safety vest = trainee (<10 orders), give lighter single-order loads. Beer emoji = Smart Serve certified, required for alcohol orders -- keep at least one per market.
7. If multiple couriers go Red simultaneously, trigger running-behind.md recovery process.

**Escalate If:**
- All couriers overloaded with no capacity to rebalance
- Ratio of overloaded-to-idle exceeds threshold needing human review
