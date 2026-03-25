---
agent: supervisor
trigger: shift_start
priority: critical
version: "1.0"
---

# Process: Shift Start Procedures

## Trigger

When Sisyphus begins a new operating shift. This runs once at the beginning of each shift before any other agent activity begins.

## Prerequisites

None — this is the first process that runs. It establishes the prerequisites for everything else.

## Startup Sequence

### Step 1: Verify System Connections

Check each dependency in order. If any critical connection fails, do not proceed — escalate immediately.

| System | Check Method | Critical? |
|--------|-------------|-----------|
| Chrome/Browser Executor | Verify browser session is active and dispatch UI is loaded | Yes |
| Redis | Ping Redis — confirm connection for locks and cooldowns | Yes |
| PostgreSQL | Test query against Sisyphus audit tables | Yes |
| DynamoDB | `query_orders({ status: "Pending", limit: 1 })` — confirm read access | Yes |
| S3 Dispatch Snapshots | Verify latest snapshot is < 2 minutes old | No (warn) |
| DynaClone (MySQL) | Test connection to `iris.valleyeats.ca` | No (warn) |

If a critical connection fails:
1. Log the failure: `execute_action("LogShiftEvent", { event: "shift_start_failed", reason: "..." })`
2. Call `request_clarification({ urgency: "critical", category: "system_anomaly" })`
3. Do not proceed until the connection is restored

If a non-critical connection fails:
1. Log a warning and continue
2. Note the degraded capability for the shift

### Step 2: Load Previous Shift Handoff

Query the most recent shift summary:
- [ ] `query_shift_summaries({ limit: 1, sort: "desc" })` — get last shift's handoff notes

Review the handoff for:
- Unresolved issues flagged for this shift
- Drivers marked as unresponsive who may still be on duty
- Ongoing situations requiring follow-up (e.g., restaurant outage, recurring customer complaint)
- Any special instructions left by the previous shift operator

### Step 3: Check Unresolved Issues

Scan for items that carried over:
- [ ] `query_tickets({ status: ["New", "Pending"] })` — open support tickets
- [ ] `query_orders({ status: "Pending" })` — unassigned orders (should be 0 at shift start; if not, immediate attention)
- [ ] `query_orders({ status: ["Confirmed", "Ready"] })` — orders in progress without driver movement

For each unresolved item:
1. Check its age — if older than 30 minutes, prioritize it
2. Determine which sub-agent should handle it
3. Add to the initial task queue

### Step 4: Verify Market Health

Poll all active markets:
- [ ] `query_market_health({})` — get `MarketMeters` for all zones

For each market, check:
- `MarketMeters.Score` — if > 80, flag as needing attention (100 = critical need)
- `MarketMeters.drivers` vs `MarketMeters.idealDrivers` — driver gap
- `Alerts.Eta` — current ETA per market (query `Alerts` table, key: `{Market}Eta`)

Log a shift-start market snapshot for comparison throughout the shift.

### Step 5: Verify Driver Coverage

Check scheduled drivers for this shift:
- [ ] Query `DriverShifts` via DynaClone: drivers with `shiftstart <= now AND shiftend >= now` per market
- [ ] `query_drivers({ isAvailable: true })` — currently online drivers

Compare scheduled vs. actually online. If the gap is significant (>30% of scheduled drivers not online), note it as a monitoring priority.

### Step 6: Log Shift Start

Record the shift start in the audit trail:
- [ ] `execute_action("LogShiftEvent", { event: "shift_start", operator: "sisyphus", timestamp: now, market_snapshot: {...}, unresolved_count: N, system_status: "all_green" | "degraded" })`

Include in the log:
- All system connection statuses
- Count of unresolved items from previous shift
- Market health summary (per-zone scores)
- Driver coverage summary
- Any warnings or degraded capabilities

## Post-Startup

Once all steps complete:
1. Activate the Market Monitor agent on its polling loop
2. Begin the supervisor's main triage loop (see `triage-priority.md`)
3. Process any unresolved items identified in Step 3, highest priority first

## Logging

The shift start event is logged via `execute_action("LogShiftEvent")` in Step 6. All subsequent actions during the shift are logged automatically by the ontology action layer.
