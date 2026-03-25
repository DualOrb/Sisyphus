---
agent: supervisor
trigger: shift_end
priority: critical
version: "1.0"
---

# Process: Shift End & Handoff

## Trigger

When the current operating shift is ending — either at the scheduled end time or when a human dispatcher signals takeover.

## Prerequisites

Before beginning shutdown:
- [ ] `query_orders({ status: ["Pending", "Confirmed", "Ready"] })` — check for in-progress orders
- [ ] `query_tickets({ status: ["New", "Pending"] })` — check for open tickets
- [ ] Confirm no sub-agent is mid-task (check `active_tasks` in shared state)

## Shutdown Sequence

### Step 1: Complete or Hand Off In-Progress Tasks

For each active task:

**If completable within 5 minutes:**
- Finish the task (send final message, close ticket, resolve alert)
- Log the resolution normally

**If not completable within 5 minutes:**
- Add a handoff note to the task: `execute_action("AddTicketNote", { note: "SHIFT HANDOFF: [current state, what's been done, what remains]" })`
- Flag the item for the next shift

Do NOT start any new non-urgent work during shift-end procedures.

### Step 2: Generate Shift Summary

Compile statistics from the shift's audit trail:

**Actions Taken:**
- Total ontology actions executed
- Breakdown by type (messages sent, tickets resolved, orders reassigned, etc.)
- Actions that were blocked by cooldowns or tier restrictions

**Issues Resolved:**
- Tickets closed (with resolution categories)
- Driver communication issues resolved
- Market health alerts handled

**Escalations:**
- Total escalations to human dispatchers
- Breakdown by category (safety, financial, legal, system, authority)
- Which escalations were resolved vs. still pending

**Market Performance:**
- Per-zone health scores at shift start vs. shift end
- Average `MarketMeters.Score` across markets during the shift
- Peak driver gap observed (from `MarketMeters.idealDrivers - MarketMeters.drivers`)
- Average market ETA from `Alerts.Eta` values

**Driver Stats:**
- Total driver messages sent and received
- Unresponsive drivers (3+ unanswered follow-ups)
- Reassignments performed

### Step 3: Flag Unresolved Items

Create a clear list for the next shift:

- [ ] `query_tickets({ status: ["New", "Pending"] })` — open tickets with context notes
- [ ] `query_orders({ status: "Pending" })` — any still-unassigned orders
- [ ] Check for drivers marked as unresponsive during this shift
- [ ] Note any ongoing system issues (degraded connections, recurring failures)
- [ ] Flag markets with `MarketMeters.Score > 80` that may need attention

For each unresolved item, include:
- Entity ID (`IssueId`, `OrderId`, `DriverId`)
- Brief description of the situation
- What was already attempted
- Recommended next step

### Step 4: Log Shift End

Record the shift end in the audit trail:
- [ ] `execute_action("LogShiftEvent", { event: "shift_end", operator: "sisyphus", timestamp: now })`

The shift summary payload should include:

```
{
  shift_start: <timestamp>,
  shift_end: <timestamp>,
  duration_minutes: N,
  actions_total: N,
  tickets_resolved: N,
  tickets_open: N,
  escalations_total: N,
  escalations_pending: N,
  messages_sent: N,
  reassignments: N,
  market_health_avg: N,
  unresolved_items: [ { entity_id, type, summary, next_step } ],
  notes: "Free-text notes about anything unusual"
}
```

Store this in the `ValleyEats-SisyphusShiftSummary` table (or PostgreSQL equivalent):
- PK: `ShiftDate` (ISO date)
- SK: `ShiftId` (unique identifier)

### Step 5: Graceful Shutdown

1. Stop the Market Monitor polling loop
2. Stop the supervisor triage loop
3. Allow any in-flight ontology actions to complete (wait up to 30 seconds)
4. Release all Redis locks held by Sisyphus agents
5. Log final confirmation: shift ended cleanly

## Logging

The shift end event and full summary are logged via `execute_action("LogShiftEvent")` in Step 4. This record is the primary handoff artifact for the next shift (human or AI).
