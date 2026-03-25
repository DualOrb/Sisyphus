---
agent: market-monitor
trigger: polling_loop
priority: normal
version: "1.0"
---

# Process: Market Health Monitoring

## Trigger

Runs on a continuous polling loop every 30-60 seconds. The Market Monitor agent checks all active delivery zones and raises alerts when thresholds are breached.

## Prerequisites

Each polling cycle, gather:
- [ ] `query_market_health({})` — fetch all `MarketMeters` records (one per market)
- [ ] `query_alerts({})` — fetch all `Alerts` records for current ETAs (key format: `{Market}Eta`)
- [ ] `query_orders({ status: "Pending" })` — unassigned orders across all zones
- [ ] `query_drivers({ isAvailable: true })` — available driver count per zone

## Health Score Interpretation

`MarketMeters.Score` ranges from 0 to 100 where **100 = critical need** (high demand, low supply). This is the inverse of a typical "health" score.

| Score Range | Level | Meaning | Action |
|-------------|-------|---------|--------|
| **> 80** | CRITICAL | Severe undersupply — orders at risk of going unassigned | Alert supervisor immediately |
| **60 - 80** | WARNING | Demand is outpacing supply — monitor closely | Increase polling frequency to 30s, flag to supervisor |
| **40 - 60** | WATCH | Slightly elevated demand — normal during peaks | Log, continue monitoring at standard frequency |
| **< 40** | HEALTHY | Adequate or excess driver supply | No action needed |

## Monitoring Checks

### Check 1: Market Score

For each market, read `MarketMeters.Score`:
- [ ] `query_market_health({ market: "{MarketName}" })` — returns `Score`, `idealDrivers`, `drivers`, `ts`

If `Score > 80`:
1. Verify the reading is fresh — `ts` should be within the last 2 minutes
2. Calculate driver gap: `idealDrivers - drivers`
3. Alert supervisor: `request_clarification({ urgency: "high", category: "market_health", market: "...", score: N, driverGap: N })`
4. Log the alert for trend tracking

If `Score` between 60-80:
1. Increase polling frequency for this market to every 30 seconds
2. Log a warning-level entry
3. If score remains in warning range for 5+ minutes, escalate to supervisor

### Check 2: Driver-to-Order Ratio

Compute per zone: `availableDrivers / activeOrders` (use `MarketMeters.drivers` for available count, count pending + in-progress orders from `query_orders`).

| Ratio | Status | Action |
|-------|--------|--------|
| >= 1.5 | Oversupplied | No action |
| 1.0 - 1.5 | Balanced | Monitor |
| 0.5 - 1.0 | Understaffed | Flag to supervisor as warning |
| < 0.5 | Critical | Alert supervisor immediately — orders will go unassigned |

### Check 3: Unassigned Order Detection

Query: `query_orders({ status: "Pending" })`

For each unassigned order:
1. Calculate age: `now - OrderCreatedTime` (values are Unix epoch seconds)
2. If age > 180 seconds (3 minutes): flag to supervisor as Priority 2 (customer-facing)
3. If age > 300 seconds (5 minutes): escalate with urgency `high`
4. If age > 600 seconds (10 minutes): escalate with urgency `critical`

Include in the alert:
- `OrderId`, `OrderIdKey`, `DeliveryZone`
- Order age in minutes
- Available drivers in that zone (`MarketMeters.drivers`)
- Whether `MarketMeters.idealDrivers` > 0 (is the system even expecting drivers?)

### Check 4: ETA Monitoring

Query: `query_alerts({ title: "{Market}Eta" })` — returns `Eta` (string, in minutes)

For each market:
- Parse `Eta` to integer
- If `Eta > 25`: flag as market slowdown to supervisor
- If `Eta > 40`: escalate with urgency `high` — customers are experiencing unacceptable waits
- If `Eta` is missing or stale (`timestamp` > 5 minutes old): log a warning, the data may be unreliable

### Check 5: Driver Supply Gap

From `MarketMeters`: compare `idealDrivers` vs `drivers` (available count).

| Gap (`idealDrivers - drivers`) | Status | Action |
|-------------------------------|--------|--------|
| <= 0 | Sufficient | No action |
| 1-2 | Minor gap | Log, monitor |
| 3-4 | Significant gap | Alert supervisor |
| >= 5 | Severe shortage | Escalate with urgency `high` — may need human to call drivers or open shifts |

## Trend Tracking

Maintain a rolling window of the last 10 readings per market (in LangGraph shared state):
- If `Score` has increased for 5 consecutive readings, flag as "deteriorating market"
- If `Score` has decreased for 5 consecutive readings, note as "recovering market"
- Log trend direction changes for the shift summary

## Cooldown Rules

| Action | Minimum Wait | Notes |
|--------|-------------|-------|
| Alert supervisor (same market, same level) | 5 minutes | Avoid spamming repeated alerts |
| Escalate to human (same market) | 10 minutes | Unless severity increases |
| Log health snapshot | 0 (every cycle) | Always log for trend data |

## Escalation

Escalate to supervisor (who may further escalate to human) if:
- Any market has `Score > 80` for more than 5 minutes
- 3+ markets simultaneously at WARNING or above
- Any unassigned order exceeds 5 minutes old
- Driver-to-order ratio drops below 0.5 in any zone
- System-wide anomaly: all markets showing `Score > 60` simultaneously

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `LogMarketHealth` | GREEN | Every polling cycle — record snapshot |
| `AddTicketNote` | GREEN | Documenting a market alert on a related ticket |
| `request_clarification` | — | Alerting supervisor of threshold breach |

## Logging

Each polling cycle automatically logs the market snapshot. Alert-level events generate additional audit records when `request_clarification` is called.
