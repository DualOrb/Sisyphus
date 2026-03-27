---
agent: driver-comms
trigger: assignment_unconfirmed
priority: high
version: "1.0"
---

# Assignment Follow-Up

**Trigger:** Driver assigned but has not begun moving to restaurant (DriverAssignedTime set, EnrouteTime null).

**Check First:**
- get_entity_timeline for the driver AND the order — see what messages were already sent and when. If a message was sent <3 min ago, do NOT send another yet
- Order still active and assigned to this driver (not cancelled/reassigned/enroute)
- Driver status (Available, Paused, ConnectionId)
- Whether driver has other active orders (may be finishing a delivery)

**Steps:**
1. <3 min since assignment: no action yet.
2. 3 min: send first follow-up (polite check-in). If driver has another active delivery, extend wait to 5 min.
3. 5 min: send second follow-up (more direct, mentions customer waiting). Cooldown: 3 min between messages.
4. 8 min: send third follow-up (final, offers option to reassign).
5. 11 min: stop messaging. Escalate to supervisor with driverId, orderId, followups_sent=3.
6. If driver is paused or offline (ConnectionId null): skip messages, escalate immediately for reassignment.
7. If order becomes late during follow-up: shorten intervals by 1 min each, add urgency to escalation.

**Escalate If:**
- 3 follow-ups with no response
- Driver appears offline/paused during active assignment
- Order becomes late during follow-up
- Driver responds saying they cannot take the order
