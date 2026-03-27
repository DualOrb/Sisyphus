---
agent: supervisor
trigger: strategy_balancing
context: dispatching
priority: high
version: "1.0"
source: "Dispatch Analyst Guide — Dispatching Strategies: Balancing"
---

# Dispatch Strategy: Balancing

**Trigger:** Continuous monitoring loop -- distribute orders so no courier is overloaded while another sits idle.

**Check First:**
- Courier utilization HUD: color and numbers for each courier
- Pending/upcoming orders in the market

**Steps:**
1. **Red couriers (overloaded):** open their order list, identify movable orders, reroute to Green/Blue couriers, communicate change to both.
2. **Blue couriers (empty):** scan order table for reroute candidates or upcoming orders near their location. An idle courier is wasted capacity.
3. **Yellow couriers (conflicting):** if planned bundle and route makes sense, ignore. If unintended conflict, reroute one order.
4. **Watch conflict count** (top-right): 2+ conflicts = heading toward overload, act before Red.
5. **Watch late count** (bottom-right): 2+ late = courier falling behind, reroute upcoming orders.
6. **Key rules:** never stack orders on Red couriers. Trainees (orange vest) get single orders only. Smart Serve couriers (beer emoji) must be preserved for alcohol orders -- do not send them on long trips out of market. Balance across markets, not just within.
7. **Goal: every courier should be Green -- busy but not overloaded.**

**Escalate If:**
- All couriers overloaded and no rebalancing possible
- Adjacent market has excess capacity but cross-market coordination needed
