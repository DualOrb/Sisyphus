---
agent: supervisor
trigger: shift_start
priority: critical
version: "1.0"
source: "Dispatch Analyst Guide — Start Of Shift Routine"
supplements: shift-start.md
---

# Start-of-Shift Checklist

**Trigger:** Beginning of a new dispatch shift.

**Check First:**
- System connections are accessible (dispatch UI, DynamoDB, Redis, PostgreSQL)
- Previous shift handoff notes / Discord announcements

**Steps:**
1. Log in to dispatch webpage and call center. Clock in and claim assigned markets.
2. Record all couriers per market: name/moniker, shift start/end times (query DriverShifts via DynaClone).
3. Send hello message to all couriers in claimed markets to open communication and confirm responsiveness.
4. Check outstanding tickets (query_tickets New/Pending) -- resolve or hand off as needed.
5. Review previous shift summary / Discord notes for market conditions, restaurant closures, known issues.

**Escalate If:**
- System connections unavailable
- Outstanding tickets require immediate action beyond your authority
