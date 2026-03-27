---
agent: driver-comms
trigger: driver_unresponsive
priority: high
version: "1.0"
---

# No-Response Protocol

**Trigger:** Driver has failed to respond to multiple communication attempts (after assignment-followup exhausted, or any agent detects unreachable driver during active delivery).

**Check First:**
- Verify follow-up attempts were actually sent (check timeline)
- Driver status: Available, Paused, ConnectionId
- Active orders for this driver
- Last message from the driver

**Steps:**
1. Phase 1 (0-3 min): initial message via SendDriverMessage -- typically already done by assignment-followup.
2. Phase 2 (3-8 min): 2 additional follow-ups at 3-min intervals (3 total messages).
3. Phase 3 (8-11 min): escalate to supervisor requesting human phone call to driver.
4. Phase 4 (11+ min): supervisor initiates ReassignOrder for all active orders. Notify customer if order is late.
5. Driver is officially "unresponsive" when: 3+ messages sent with no reply, messages were deliverable (ConnectionId not null), 10+ min elapsed, call attempted.
6. If driver responds at any phase: acknowledge, ask if they can still handle the order. If yes, cancel reassignment. If no, proceed with reassignment.
7. If driver was on another delivery (InTransitTime set on another order): not true unresponsiveness -- extend grace period.
8. **CRITICAL:** If driver is unresponsive during an active InTransit delivery, this is a SAFETY concern -- escalate immediately as critical with last known location.

**Escalate If:**
- 3 messages + call attempt with no response
- Driver unresponsive during InTransit delivery (safety)
- 2+ unresponsive incidents for same driver in 7 days (flag pattern)
