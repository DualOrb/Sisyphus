---
agent: supervisor
trigger: strategy_bundling
context: dispatching
priority: high
version: "1.0"
source: "Dispatch Analyst Guide — Dispatching Strategies: Bundling"
---

# Dispatch Strategy: Bundling

**Trigger:** Opportunity to assign multiple orders to one courier for efficiency.

**Check First:**
- Are delivery addresses near each other or on the way?
- Are restaurants close together?
- Is the time between pickups <5 minutes?

**Steps:**
1. **Three bundle types:** same restaurant (one pickup stop), same customer address (one delivery stop), same area/zone (courier already going there).
2. **Three rules -- ALL must be met:** (a) delivery addresses near each other or one on the way, (b) restaurants close together, (c) minimal time between pickups (max 5 min gap; if longer, ask restaurant to have both ready at same time).
3. **Route must follow delivery-distance order: closest address first. No backtracking (delivering east then west then east again). Maximum 5 km detour for a bundled pickup.** Planned bundles may show Yellow on HUD -- acceptable if route is logical.
4. **Communication required:** tell courier the plan (which restaurants, orders, sequence). Tell restaurant(s) about groupings so they prepare together.
5. **Anti-patterns to avoid:** opposite-direction deliveries, pickup gap >5 min without restaurant adjustment, bundling on trainees (orange vest), adding to Red (overloaded) couriers, ignoring delivery sequence.
6. **During recovery (running behind):** delays create NEW bundling opportunities. Look for orders that now overlap due to timing shifts.

**Escalate If:**
- Bundle requires complex cross-market coordination
- Courier is already overloaded and cannot absorb the bundle
