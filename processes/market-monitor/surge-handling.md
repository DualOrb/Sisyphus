---
agent: market-monitor
trigger: surge_detected
priority: high
version: "1.0"
---

# Process: Surge Handling

## Trigger

When the Market Monitor detects a significant spike in order volume or a rapid deterioration in driver supply within a zone. This process supplements `market-health.md` with specific surge response procedures.

## Prerequisites

Before declaring a surge, confirm the signal:
- [ ] `query_market_health({ market: "{MarketName}" })` — get `MarketMeters.Score`, `idealDrivers`, `drivers`
- [ ] `query_orders({ deliveryZone: "{zone}", status: "Pending" })` — count unassigned orders
- [ ] `query_alerts({ title: "{Market}Eta" })` — current ETA for the market
- [ ] `query_orders({ deliveryZone: "{zone}", status: ["Confirmed", "Ready"] })` — total active orders in zone

## Surge Detection Criteria

A surge is confirmed when ANY of these conditions are met:

| Condition | Threshold | How to Detect |
|-----------|-----------|---------------|
| Order volume spike | Active orders > 2x the typical count for this market and time of day | Compare current active order count against `DemandPredictions.drivers_predicted` baseline |
| Driver gap widening | `idealDrivers - drivers >= 3` AND increasing over 3 consecutive readings | Track `MarketMeters` readings in rolling window |
| Score spike | `MarketMeters.Score` jumps from < 60 to > 80 within 2 minutes | Compare current vs. previous reading |
| Unassigned order pileup | 3+ orders with `status: "Pending"` in the same zone simultaneously | `query_orders({ status: "Pending", deliveryZone: zone })` |
| ETA escalation | `Alerts.Eta` increases by more than 10 minutes within 5 minutes | Compare current vs. recent ETA readings |

## Surge Severity Levels

| Level | Criteria | Response |
|-------|----------|----------|
| **MODERATE** | Score 60-80, driver gap 3-4, 2-3 unassigned orders | Increase monitoring, notify supervisor |
| **SEVERE** | Score > 80, driver gap >= 5, or 4+ unassigned orders | Notify supervisor + flag for human awareness |
| **CRITICAL** | Score = 100, zero available drivers, or 5+ unassigned orders aging > 5 min | Immediate human escalation |

## Response Procedures

### Immediate Actions (All Severity Levels)

1. **Increase polling frequency** to every 15 seconds for the affected zone
2. **Log the surge start**: include zone, score, driver count, unassigned order count, time
3. **Notify supervisor**: `request_clarification({ urgency: severity_level, category: "surge", market: "...", details: {...} })`

### Moderate Surge

4. Check for off-duty drivers in the zone:
   - [ ] Query `DriverShifts` via DynaClone: drivers with shifts starting within the next hour in this market
   - [ ] `query_drivers({ dispatchZone: zone, isPaused: true })` — drivers who are paused but online
5. Report findings to supervisor — supervisor decides whether to message paused drivers
6. Monitor for escalation to severe

### Severe Surge

4. All Moderate actions, plus:
5. Check adjacent zones for available drivers:
   - [ ] `query_drivers({ isAvailable: true })` — filter for zones adjacent to the affected zone
6. Alert supervisor to consider cross-zone driver rebalancing
7. Flag for human dispatcher awareness: `request_clarification({ urgency: "high", category: "surge", recommendation: "Human may need to call drivers or open emergency shifts" })`

### Critical Surge

4. All Severe actions, plus:
5. Escalate directly to human: `request_clarification({ urgency: "critical", category: "surge" })`
6. Include in escalation:
   - Number of unassigned orders and their ages
   - Number of available drivers (likely 0)
   - Current `MarketMeters.Score` and `Alerts.Eta`
   - Whether this appears to be a system anomaly vs. genuine demand spike
7. Continue monitoring but do NOT take autonomous staffing actions — human handles critical surges

## During a Surge

While a surge is active:

- **Polling frequency**: Every 15 seconds for the affected zone
- **Track each unassigned order individually**: Log how long each has been waiting
- **Monitor for resolution signals**: Score dropping, drivers coming online, orders getting assigned
- **Update supervisor** every 2 minutes with current stats if the surge persists

## Surge Resolution

A surge is considered resolved when ALL of these hold for 5 consecutive readings:
- `MarketMeters.Score < 60` for the affected zone
- Zero unassigned orders older than 3 minutes
- `idealDrivers - drivers <= 2`

When resolved:
1. Log surge end with duration and impact summary
2. Return polling frequency to normal (30-60 seconds)
3. Notify supervisor that the surge has cleared
4. Include in the shift summary: surge start/end times, peak severity, orders affected

## Cooldown Rules

| Action | Minimum Wait | Notes |
|--------|-------------|-------|
| Surge alert to supervisor (same zone) | 2 minutes | Unless severity increases |
| Human escalation (same zone) | 10 minutes | Unless new critical threshold crossed |
| Cross-zone driver check | 5 minutes | Avoid redundant queries |

## Escalation

Escalate to human (beyond supervisor) if:
- Critical surge persists for more than 10 minutes
- Severe surge persists for more than 20 minutes
- Multiple zones surge simultaneously (possible system-wide event)
- You suspect the data is wrong (e.g., Score = 100 but orders are being delivered normally)

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `LogMarketHealth` | GREEN | Increased-frequency snapshot logging during surge |
| `AddTicketNote` | GREEN | Annotating related tickets with surge context |
| `request_clarification` | — | Notifying supervisor or escalating to human |

## Logging

Surge events are logged as part of the market health snapshot. Start and end of each surge are recorded with full context for the shift summary.
