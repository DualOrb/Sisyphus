---
agent: supervisor
trigger: shift_end
priority: critical
version: "1.0"
source: "Dispatch Analyst Guide — End of Shift Routine"
supplements: shift-end.md
---

# End-of-Shift Checklist

**Trigger:** End of a dispatch shift.

**Check First:**
- Open tickets assigned to you
- Active orders still in progress

**Steps:**
1. Go offline in Ticket Tracker so no new calls/tickets route to you.
2. Complete any finishable tickets. Reassign remaining tickets to next support person with full context and handoff notes. Notify affected customers we will follow up.
3. Send positive goodnight/thank-you message to all couriers.
4. Generate shift summary for incoming dispatcher: market state, ongoing issues, driver coverage, anything needing monitoring. Store in shift summary artifact.
5. Clock out. Follow office closing procedures.

**Escalate If:**
- Orphaned tickets with no available assignee
- Critical unresolved issues that cannot wait for the next shift
