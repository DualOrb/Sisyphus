---
agent: supervisor
trigger: market_health_degraded
priority: critical
version: "1.0"
source: "Dispatch Analyst Guide — Steps to Take when Running Behind"
---

# Running Behind -- Recovery Procedures

**Trigger:** Speed gauge in red, orders building up with insufficient courier capacity, multiple yellow/red prediction boxes.

**Check First:**
- Current courier utilization across the market
- Which orders are late or approaching late
- Available/finishing couriers in next 10-15 minutes

**Steps (repeat until load is reduced):**
1. **Find available couriers in 10-15 min:** scan for couriers finishing a delivery with no follow-on orders. Assign them immediately.
2. **Bundle late orders:** delays create new bundling opportunities (orders that were spread apart now overlap). Reduces total trips needed.
3. **Push for on-call couriers:** send push notification requesting additional drivers for the market.
4. **Redistribute load via time views:** identify peak periods, move orders forward/back to smooth spikes. Find catch-up windows between rushes.
5. **Re-evaluate delays:** adjust market delay settings. Avoid setting market to "Stop" at all costs.
6. **Sanity check:** flag situation for human dispatcher review when Score >80.
7. **Last resort (supervisor only):** switch to "Takeout Only" to stop new delivery orders and clear backlog. This stops revenue and is hard to recover from.

**Escalate If:**
- All steps exhausted and still past maximum acceptable delay
- Need human authorization for Takeout Only mode
- Multiple markets running behind simultaneously
