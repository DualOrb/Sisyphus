---
agent: supervisor
trigger: utilization_check
context: dispatching
priority: high
version: "1.0"
source: "Dispatch Analyst Guide — Courier Utilization Heads Up Display, Market Information"
---

# Courier Utilization HUD Reference

## What It Is

The Courier Utilization Heads-Up Display (HUD) is a visual panel that shows the real-time status of every courier in a market. It appears as a set of colored squares at the bottom of each market tab on the dispatch screen.

This is the primary tool for detecting imbalances — overloaded couriers, idle couriers, and conflicts — at a glance.

---

## Color Codes

Each courier is represented by a colored tile. The color indicates their current utilization status:

| Color | Status | Meaning | Dispatcher Action |
|-------|--------|---------|-------------------|
| **Red** | Overloaded | Courier has too many orders, conflicting routes, or multiple late orders | Immediately reroute orders away. Do NOT add more orders. |
| **Yellow** | Potentially conflicting | Courier has orders that may conflict in timing or routing | Review the route. If it is a planned bundle and the route makes sense, ignore. If unplanned, fix the conflict. |
| **Green** | OK | Courier is busy but within capacity | Normal operations. Can accept additional orders if needed. |
| **Blue** | Empty | Courier has no current orders | Assign orders immediately. Scan the order table for reroute candidates. |
| **Black** | Off-shift | Courier is within 15 minutes before shift start or within 30 minutes after shift end | Do not assign orders unless their shift is about to begin. |

---

## HUD Numbers

Each courier tile displays three numbers that provide detail beyond the color:

### Top Left: Total Order Count

The total number of orders currently assigned to this courier.

- A courier with 1-2 orders is typically fine
- 3+ orders requires attention — check whether the routes and timing align
- The acceptable count depends on order proximity and courier experience

### Top Right: Conflict Count

The number of orders that have timing or routing conflicts with each other.

- 0 conflicts = good
- 1 conflict = may be a deliberate bundle (yellow is expected); verify the route
- 2+ conflicts = likely overloaded or has genuinely conflicting assignments; investigate immediately

### Bottom Right: Late Order Count

The number of orders the courier is currently late on (past pickup or delivery time).

- 0 late = on track
- 1 late = monitor — check if it is a minor delay or a cascading issue
- 2+ late = courier is falling behind; their future orders will also be late; reroute upcoming orders to other couriers

---

## Reading the HUD: What Each State Looks Like

### Healthy Market

- Most couriers are **Green**
- A few may be **Yellow** (planned bundles or minor timing overlap)
- No **Red** couriers
- Few or no **Blue** couriers during peak hours (everyone is productively busy)
- **Blue** couriers between rushes are normal and expected

### Overloaded Market

- One or more **Red** couriers
- Multiple **Yellow** couriers with high conflict counts
- Late order counts climbing across multiple couriers
- Possibly some **Blue** couriers who should be absorbing load but are not being used

### Underutilized Market

- Many **Blue** couriers
- Green couriers with only 1 order each
- No backlog of orders
- This may indicate overstaffing or a slow period — not necessarily a problem, but worth noting

### Imbalanced Market

- Mix of **Red** and **Blue** couriers simultaneously
- This is the most actionable state: orders need to be moved from Red couriers to Blue couriers immediately
- This is a failure of distribution, not a capacity problem

---

## How to Rebalance

When the HUD shows an imbalance:

### Step 1: Identify the Overloaded Couriers (Red)

Open their order list. Look for orders that:
- Have not started yet (no En-Route or At Restaurant status)
- Are going in a different direction than their current delivery
- Have a pickup time that another courier could make

### Step 2: Identify Available Couriers (Blue or Green with Low Load)

Find couriers who:
- Are empty (Blue) and positioned near the restaurant for the order being rerouted
- Are Green with only 1 order and have capacity for more
- Will be available within a few minutes (finishing their current delivery)

### Step 3: Reroute

Reassign the order from the overloaded courier to the available courier:
- Click the courier moniker on the order
- Select the target courier from the dropdown
- Or click "anyone else" to let the system auto-assign to a different courier
- Or click "surprise me" to let the system pick the optimal courier (note: this may reassign back to the same courier)

### Step 4: Communicate

- Tell the original courier the order has been moved (so they do not go to the restaurant for it)
- Tell the new courier about their new order
- If timing changed, notify the restaurant

---

## Special Courier Indicators (Visible on HUD/Dispatch)

Beyond the color and numbers, watch for these visual indicators on courier names:

| Indicator | Meaning | Dispatch Impact |
|-----------|---------|----------------|
| **Orange safety vest** | Trainee courier (< 10 orders or repeated issues) | Give lighter loads. Single orders only. Monitor closely. |
| **Beer emoji** | Smart Serve certified | Required for alcohol orders. Do not send on long trips if alcohol orders are expected. Keep at least one Smart Serve courier available per market. |

---

## Market-Level Context

The market tab itself provides context for interpreting the HUD:

- **Current market delay:** Shown in the market box. The delay is the time given for a courier to arrive at a restaurant after an order is confirmed. Auto-adjusted by the Supervisor Bot.
- **Red box on market tab:** A restaurant or courier has not confirmed an order with a pickup of fewer than 15 minutes. This is a warning to take action.
- **Courier squares at the bottom of the market tab:** These ARE the HUD. Red squares = late orders. Black squares = off-shift.

---

## Sisyphus Implementation

The HUD monitoring loop:

1. Poll courier utilization status for all active couriers per market at regular intervals
2. Detect state transitions (Green -> Yellow, Yellow -> Red, Green -> Blue)
3. On Red detection: immediately evaluate reroute options and execute if a better assignment exists
4. On Blue detection: scan pending/upcoming orders for assignment candidates
5. On Yellow detection: check whether it is a planned bundle (check shift notes / recent bundle actions) or an unintended conflict
6. Track the ratio of Red:Green:Blue across the shift for the shift summary
7. If multiple couriers go Red simultaneously, trigger the Running Behind recovery process (see `running-behind.md`)
8. Log all rebalancing actions with before/after courier state
