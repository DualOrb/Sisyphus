---
agent: driver-comms
trigger: new_driver_message
priority: normal
version: "1.0"
---

# Responding to Driver Messages

**Trigger:** New message from a driver, or supervisor delegates a driver communication task.

**Check First:**
- Driver's active orders and recent interactions
- Open tickets related to this driver

**Steps:**
1. **Order issue:** identify order, get full details. If late: acknowledge, check if customer notified. If can't find customer: provide address + instructions, suggest calling. If can't complete: escalate to supervisor. If restaurant issue: acknowledge, document.
2. **Status update:** acknowledge. If concerning (traffic on late order), check timeline for duration.
3. **Complaint/request:** acknowledge, gather context. Resolve if within authority. Escalate if not (pay disputes, deactivation, policy).
4. **Greeting/check-in:** respond briefly.
5. **Unclear message:** ask one clarifying question referencing the likely order. Do not guess.
6. **Response rules:** max 2 messages before waiting for response. Always reference order by orderIdKey. Under 160 chars. Use first name. Never blame driver for system issues. Never promise specific ETAs without data.

**Escalate If:**
- Driver threatening, abusive, or appears unsafe
- Physical safety concern
- 3 follow-ups with no response
- Cancellation/reassignment unclear
- Financial impact >$50
- Policy dispute with no clear answer
- Any situation where you are unsure
