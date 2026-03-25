---
agent: supervisor
trigger: market_health_degraded
priority: critical
version: "1.0"
source: "Dispatch Analyst Guide — Steps to Take when Running Behind"
---

# Process: Running Behind — Recovery Procedures

## When This Applies

You are running behind when any of the following indicators are present:

- The speed gauge is in the red
- A large number of far-out orders are pulling couriers out of town
- Orders are building up at a certain timeframe with insufficient courier capacity to clear them
- Multiple orders show yellow or red pickup/delivery prediction boxes

This is a critical situation. Every minute of delay compounds — a late pickup cascades into late deliveries for every subsequent order that courier handles.

---

## Recovery Steps (Repeat Until Load Is Reduced)

### Step 1: Find Available Couriers in the Next 10-15 Minutes

Scan the order table for couriers who:

- Are finishing up a delivery but have no orders queued after it
- Have a gap in their schedule that is not immediately obvious from the main view
- Are returning from a delivery and will be near restaurants with pending orders

These couriers can take an order immediately to help lessen the load. This is the fastest way to recover because the courier is already on shift and in the field.

**Sisyphus implementation:** Query all courier statuses and upcoming order assignments. Identify couriers whose last order completes within 10-15 minutes and who have no follow-on assignment. Flag them as available for immediate reassignment.

---

### Step 2: Bundle Late Orders

When orders are delayed past their original pickup time, new bundling opportunities open up that were not possible before:

- Two orders from the same restaurant that are both late can now be picked up together
- Two orders going to the same area that were originally spread apart in time can be combined
- A late order can be paired with a new order whose timing now aligns

Look for these new bundles. They reduce the total number of trips needed to clear the backlog.

See `dispatch-strategy-bundling.md` for full bundling rules.

---

### Step 3: Send Push Notification for On-Call Couriers

Send a push notification requesting additional couriers for your market. Even a few extra couriers jumping on-call will make a significant difference in clearing the backlog.

**Sisyphus implementation:** `execute_action("SendPushNotification", { market: "<market>", type: "courier_request" })` — request on-call drivers.

---

### Step 4: Review Time Views and Redistribute Load

Go through the time views to see when the most orders are concentrated:

- Identify the peak period causing the backup
- Look for orders that can be moved forward (picked up earlier) to spread the load
- Look for orders that can be delayed slightly (with restaurant coordination) to create breathing room
- Find sections with fewer orders that can serve as catch-up windows for late deliveries

The goal is to smooth out the spikes so couriers are not overwhelmed in one 15-minute window and idle in the next.

---

### Step 5: Re-Evaluate Delays and Adjust Market Settings

After completing steps 1-4, reassess the situation:

- Check current delays and adjust them as needed
- Avoid setting any market to "Stop" — this must be avoided at all costs to maximize profitability
- Sections with fewer orders are acceptable — they provide a fill window for late orders to be delivered before the next wave

**Sisyphus implementation:** Update `MarketMeters` delay values. Monitor the speed gauge. Log each adjustment.

---

## Repeat the Cycle

These steps are iterative. Repeat the full sequence until the load is reduced to manageable levels. Each pass should yield improvement:

1. More couriers become available (Step 1 + Step 3)
2. Fewer trips are needed (Step 2)
3. The load is more evenly distributed (Step 4)
4. Delays are accurately reflected (Step 5)

---

## Get a Sanity Check

With high order volume, it is easy to lose track of routing decisions. Ask a supervisor or colleague to review your current courier routes and confirm they make sense. A second pair of eyes catches mistakes that compound under pressure.

**Sisyphus implementation:** When `MarketMeters.Score > 80`, flag the situation for human dispatcher review via `request_clarification({ urgency: "high", category: "market_overload" })`.

---

## Last Resort: Takeout Only

If, after repeating all the above steps, you are past the maximum acceptable delay:

- A supervisor may decide to switch the market to "Takeout Only"
- This means no new delivery orders will come in, allowing focus on clearing current orders

**Why this is a last resort:**

1. It stops delivery revenue
2. Customers accidentally place takeout orders they cannot pick up
3. It is very hard to recover order volume after the lock is lifted

Only a supervisor can make this call. The dispatcher's job is to exhaust all other options first.

**Sisyphus implementation:** This decision requires human authorization. Escalate via `request_clarification({ urgency: "critical", category: "takeout_only_request", market: "<market>" })` with full context on what has been tried.

---

## Quick Reference

| Step | Action | Goal |
|------|--------|------|
| 1 | Find couriers available in 10-15 min | Immediate capacity |
| 2 | Bundle late orders | Fewer trips needed |
| 3 | Push for on-call couriers | Additional capacity |
| 4 | Review time views, redistribute | Smooth out peaks |
| 5 | Re-evaluate delays | Accurate market settings |
| — | Sanity check with colleague | Catch routing mistakes |
| LAST | Takeout Only (supervisor only) | Stop bleeding |
