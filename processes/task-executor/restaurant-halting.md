---
agent: task-executor
trigger: restaurant_halt_request
priority: high
version: "1.0"
---

# Restaurant Halting (Pause / Unpause)

**Trigger:** Restaurant needs to stop receiving new orders temporarily (backed up, equipment issue, closing early, tablet offline, unresponsive).

**Check First:**
- Restaurant record: DeliveryAvailable, Restaurant (active flag), LastHeartbeat
- Active orders (Pending, Confirmed, Ready) that must be handled before halting
- Recent halt/unhalt actions to avoid flapping

**Steps:**
1. **Halt** (DeliveryAvailable: false, YELLOW) stops new orders. Resets automatically next morning. **Deactivation** (Restaurant: false, RED) removes from platform entirely -- always requires human approval.
2. Before halting, handle active orders: Pending = confirm with restaurant if they can fulfill (if no, escalate for cancellation). Confirmed = must be completed. Ready = unaffected.
3. Set DeliveryAvailable to false with reason. Inform restaurant they can self-halt via tablet Halt button.
4. **Un-halt:** verify LastHeartbeat is fresh (<5 min), confirm restaurant is ready, verify underlying issue resolved. Set DeliveryAvailable to true.
5. Halt can substitute for Holiday Hours when restaurant is closing early near normal close time (auto-resets next morning).

**Escalate If:**
- Active orders will be affected (especially if cancellation needed -- RED tier)
- Restaurant needs deactivation, not just halt (RED tier)
- Restaurant flapping (repeated halt/unhalt) -- indicates systemic issue
- Halt reason suggests deeper problem (health issue, relationship breakdown, persistent tablet failures)
- Multiple restaurants in same market need halting simultaneously
