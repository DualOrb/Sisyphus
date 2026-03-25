---
agent: market-monitor
trigger: staffing_threshold
priority: high
version: "1.0"
---

# Process: Driver Staffing Alerts

## Trigger

When the Market Monitor's polling loop detects a significant gap between the ideal number of drivers and the actual number of available drivers in any market. This supplements `market-health.md` with specific staffing concern procedures.

## Prerequisites

Each polling cycle, check staffing metrics:
- [ ] `query_market_health({ market: "{MarketName}" })` -- returns `MarketMeters.idealDrivers`, `MarketMeters.drivers`, `MarketMeters.Score`, `MarketMeters.ts`
- [ ] `query_drivers({ dispatchZone: "{MarketName}", isAvailable: true })` -- currently online and available drivers in the zone
- [ ] `query_orders({ deliveryZone: "{MarketName}", status: "Pending" })` -- unassigned orders in the zone
- [ ] `query_orders({ deliveryZone: "{MarketName}", status: ["Confirmed", "Ready", "EnRoute"] })` -- total active orders in the zone

**Reminder:** `MarketMeters.idealDrivers` is the system-calculated number of drivers needed for current demand. `MarketMeters.drivers` is the number currently available. Both are numbers.

## Staffing Gap Detection

### Primary Check: Gap Between Ideal and Available

Calculate the driver gap: `gap = MarketMeters.idealDrivers - MarketMeters.drivers`
Calculate the ratio: `ratio = MarketMeters.drivers / MarketMeters.idealDrivers`

| Gap | Ratio | Severity | Action |
|-----|-------|----------|--------|
| <= 0 | >= 1.0 | NONE | Fully staffed or overstaffed -- no action |
| 1-2 | 0.5 - 1.0 | LOW | Log, continue monitoring at standard frequency |
| **> 2** | **< 0.5** | **HIGH** | Flag issue, check upcoming shifts, alert supervisor |
| >= 5 | < 0.3 | CRITICAL | Immediate escalation -- human intervention likely required |

A staffing alert is triggered when **either** of these conditions is met:
- `gap > 2` (more than 2 drivers short)
- `ratio < 0.5` (less than half the needed drivers are available)

### Secondary Check: Verify the Data Is Fresh

Before acting on staffing data:
- Check `MarketMeters.ts` -- if `now - ts > 120` (2 minutes), the data may be stale
- If stale, log a warning and wait for the next polling cycle rather than acting on outdated metrics
- If the data has been stale for 3+ consecutive cycles, escalate as a system anomaly

## Response Procedures

### Severity: HIGH (gap > 2 OR ratio < 0.5)

**Step 1: Flag the Issue**

Log the staffing gap and alert the supervisor:
```
request_clarification({
  urgency: "high",
  category: "staffing",
  market: "{MarketName}",
  idealDrivers: N,
  availableDrivers: N,
  gap: N,
  ratio: N,
  activeOrders: N,
  pendingOrders: N,
  recommendation: "Driver shortage in {MarketName}. Check upcoming shifts."
})
```

**Step 2: Check DynaClone for Upcoming Shifts**

Query `DriverShifts` via DynaClone (MySQL) to determine if relief is coming:

```sql
SELECT DriverId, shiftstart, shiftend, area
FROM `ValleyEats-DriverShifts`
WHERE area = '{MarketName}'
  AND shiftstart > UNIX_TIMESTAMP()
  AND shiftstart < UNIX_TIMESTAMP() + 7200
ORDER BY shiftstart ASC
```

This returns drivers scheduled to start within the next 2 hours.

**Interpreting the results:**
- If drivers are scheduled within 30 minutes: relief is imminent -- note this in the alert
- If drivers are scheduled within 1-2 hours: coverage is coming but there will be a gap
- If NO drivers are scheduled in the next 2 hours: **this is critical** -- human needs to open shifts or call drivers

Include the upcoming shift data in the supervisor alert:
```
execute_action("AddTicketNote", {
  ticketId: "{relatedTicketId}",  // if a related ticket exists
  note: "STAFFING ALERT: {MarketName} has {drivers}/{idealDrivers} drivers (gap: {gap}). Next shift starts: {shiftstart or 'NONE in next 2 hours'}. Active orders: {N}, pending: {N}."
})
```

**Step 3: Alert if No Coverage in Next 2 Hours**

If the DynaClone query returns zero upcoming shifts in the next 2 hours:
```
request_clarification({
  urgency: "critical",
  category: "staffing",
  market: "{MarketName}",
  details: "No drivers scheduled in the next 2 hours. Current gap: {N}. Human needs to open emergency shifts or contact off-duty drivers.",
  recommendation: "Open emergency shifts or call available on-call drivers"
})
```

**Step 4: Check for Paused Drivers**

Query for paused drivers who might be reactivated:
- [ ] `query_drivers({ dispatchZone: "{MarketName}", isPaused: true, isAvailable: true })` -- drivers who are online but paused

If paused drivers exist:
- Note them in the alert -- the supervisor or human may ask them to unpause
- Sisyphus does NOT automatically unpause drivers -- that is a human decision

**Step 5: Check Adjacent Markets**

If the affected market has neighboring zones with excess capacity:
- [ ] `query_market_health({})` -- check all markets
- For each adjacent market: if `drivers > idealDrivers`, there may be surplus drivers

Note any adjacent market surplus in the alert for potential cross-zone rebalancing.

### Severity: CRITICAL (gap >= 5 OR ratio < 0.3)

All HIGH severity steps, plus:

1. **Immediate human escalation:**
   ```
   request_clarification({
     urgency: "critical",
     category: "staffing",
     market: "{MarketName}",
     gap: N,
     details: "CRITICAL staffing shortage. {MarketName} has {drivers} drivers vs {idealDrivers} needed. Orders at risk of going unassigned."
   })
   ```

2. **Increase polling frequency** for this market to every 15 seconds
3. **Track each pending order individually** -- log how long each has been unassigned
4. Do NOT attempt autonomous staffing actions -- humans need to call drivers or open shifts

## Ongoing Monitoring

While a staffing alert is active:
- Continue checking every polling cycle
- Track whether the gap is growing or shrinking
- If a new driver comes online (`MarketMeters.drivers` increases), update the alert status
- If the gap resolves (gap <= 2 AND ratio >= 0.5 for 3 consecutive readings), log the resolution

## Resolution

A staffing alert is resolved when:
- `MarketMeters.idealDrivers - MarketMeters.drivers <= 2` for 3 consecutive readings
- OR `MarketMeters.drivers / MarketMeters.idealDrivers >= 0.5` for 3 consecutive readings

When resolved:
1. Log the resolution with duration: "Staffing alert for {MarketName} resolved after {N} minutes. Drivers went from {start_count} to {end_count}."
2. Return polling to normal frequency
3. Include in shift summary: start time, duration, peak gap, and how it was resolved

## Cooldown Rules

| Action | Minimum Wait | Notes |
|--------|-------------|-------|
| Staffing alert to supervisor (same market) | 5 minutes | Unless severity increases from HIGH to CRITICAL |
| Human escalation (same market) | 10 minutes | Unless the gap widens by 2+ drivers |
| DynaClone shift query (same market) | 5 minutes | Avoid redundant DB queries |

## Escalation

Escalate beyond supervisor to human if:
- No drivers scheduled in the next 2 hours in any active market
- Gap >= 5 in any market (drivers needed far exceed supply)
- 3+ markets simultaneously at HIGH severity or above
- Staffing alert persists for more than 15 minutes without improvement
- Pending orders are aging past 10 minutes with no driver assigned

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `LogMarketHealth` | GREEN | Recording staffing snapshots each polling cycle |
| `AddTicketNote` | GREEN | Annotating related tickets with staffing context |
| `request_clarification` | -- | Alerting supervisor/human of staffing shortage |

## Logging

Staffing alerts are logged as part of the market health snapshot. The start and end of each alert are recorded with full context (gap, ratio, driver counts, shift data) for the shift summary.
