---
agent: supervisor
trigger: strategy_balancing
context: dispatching
priority: high
version: "1.0"
source: "Dispatch Analyst Guide — Dispatching Strategies: Balancing"
---

# Dispatch Strategy: Balancing

## Core Principle

Check courier utilization and spread orders out to multiple couriers as appropriate to reduce overutilization. No single courier should be overloaded while another sits idle.

---

## How Balancing Works

Balancing is the continuous process of distributing orders across available couriers so that:

- No courier is overloaded with conflicting or late orders
- Idle couriers are given work before busy couriers get more
- The overall market throughput is maximized

This is not a one-time action — it is a constant monitoring loop throughout the shift.

---

## The Courier Utilization Heads-Up Display (HUD)

The primary tool for balancing is the Courier Utilization HUD. It provides a visual overview of every courier's current state in a market.

See `courier-utilization.md` for the full reference on reading the HUD.

### Quick Reference: HUD Color Codes

| Color | Meaning | Action |
|-------|---------|--------|
| **Red** | Overloaded courier | Immediately reroute orders away from this courier |
| **Yellow** | Courier with potentially conflicting orders | Review route — may be a planned bundle (acceptable) or a real conflict (fix it) |
| **Green** | OK courier | Normal operations, can accept more orders if needed |
| **Blue** | Empty courier (no current orders) | Assign orders to this courier — scan order table for reroute candidates |
| **Black** | Off-shift courier (15 min before start or 30 min after end) | Do not assign orders unless shift is starting imminently |

### HUD Numbers

Each courier tile on the HUD displays three numbers:

- **Top left:** Total number of orders assigned to the courier
- **Top right:** Number of conflicting orders (timing or routing conflicts)
- **Bottom right:** Number of late orders the courier currently has

---

## Balancing Procedure

### 1. Scan the HUD for Red (Overloaded) Couriers

When a courier shows red:
- Open their order list and identify which orders can be moved
- Find a green or blue courier who is positioned to take the order
- Reroute the order to the less-loaded courier
- Communicate the change to both couriers

### 2. Scan the HUD for Blue (Empty) Couriers

When a courier shows blue (empty):
- Scan the order table for orders that can be rerouted to this courier
- Look for upcoming orders near the empty courier's current location
- Assign orders to bring the courier into productive use
- An idle courier is wasted capacity

### 3. Watch for Yellow (Conflicting) Couriers

Yellow does not always mean a problem:
- If you deliberately planned a bundle, the courier may show yellow because the system detected a timing conflict — this is expected and can be ignored if the route makes sense
- If the yellow was NOT a planned bundle, investigate the conflict and reroute one of the conflicting orders

### 4. Monitor the Top-Right Conflict Count

The conflict count (top right number on the HUD tile) is a leading indicator:
- A courier at 0 conflicts is fine
- A courier at 1 conflict may be manageable
- A courier at 2+ conflicts is heading toward overload — act before they go red

### 5. Monitor the Bottom-Right Late Count

The late order count (bottom right) is a lagging indicator:
- A courier with 1 late order needs monitoring
- A courier with 2+ late orders is falling behind — reroute their upcoming orders to prevent the cascade from worsening

---

## Key Balancing Rules

1. **Never stack orders on an already-overloaded courier.** Even if they are closest to the restaurant, adding more orders to a red courier makes every order later.

2. **An empty courier is a problem.** Blue means unused capacity. If there are pending orders in the market, an empty courier should be getting assigned.

3. **Trainees (orange vest) get lighter loads.** Do not send multiple simultaneous orders to trainees. They need simple, single-order runs to build experience.

4. **Smart Serve couriers must be preserved.** Couriers with the beer emoji are certified to carry alcohol orders. Do not send them on long-distance runs that take them out of the market if alcohol orders are expected — you may not have another Smart Serve courier available.

5. **Balance across markets, not just within.** If one market has excess couriers and an adjacent market is short, coordinate with the other market's dispatcher (or handle it yourself if you manage both).

---

## Sisyphus Implementation

The balancing check runs as part of the continuous market monitoring loop:

1. Poll courier utilization status for all active couriers in each market
2. Flag any courier in Red status — trigger immediate reroute evaluation
3. Flag any courier in Blue status — scan for assignable orders
4. When Yellow couriers are detected, check whether the conflict was a planned bundle (in shift notes) or an unintended conflict
5. Log all rebalancing actions in the shift audit trail
6. If the ratio of overloaded-to-idle couriers exceeds a threshold, escalate for human review

The goal: **every courier should be Green — busy but not overloaded.**
