---
agent: supervisor
trigger: new_event
priority: critical
version: "1.0"
---

# Event Triage & Priority Assignment

**Trigger:** Any new event: order, driver message, ticket, market alert, or sub-agent escalation.

**Check First:**
- Pending orders, new tickets, driver availability

**Steps:**
1. **P1 SAFETY (immediate + escalate):** accident, injury, food safety, incapacitated driver. Always escalate critical to human -- never resolve safety autonomously.
2. **P2 CUSTOMER-FACING (within 2 min):** unassigned order >3 min, late order with no intervention, new ticket on active order, missing/wrong items on in-progress delivery, cancellation request (RED tier).
3. **P3 DRIVER COMMS (within 5 min):** unanswered driver message, driver hasn't confirmed after 3 min, driver reporting issue. Delegate to Driver Comms with full context.
4. **P4 MARKET HEALTH (within 10 min):** driver gap >2, avg ETA >25 min, driver:order ratio <1.0, multiple restaurants offline, order volume spike >2x. Identify bottleneck, take corrective action.
5. **P5 ADMINISTRATIVE (when no higher-priority work):** restaurant/menu updates, maintenance, reports.
6. **Conflicts:** P2 = oldest unassigned order first. P3 = active-delivery messages first. P4 = lowest driver:order ratio zone first.
7. **After every action:** re-triage. Check if priorities shifted, deferred items escalated, or sub-agents are stuck.

**Escalate If:**
- Any safety issue (always)
- 3+ unassigned orders with no available drivers
- System-wide anomaly (all drivers offline, all restaurants erroring)
- Sub-agent stuck after re-delegation
- Single refund >=$25 (RED tier) or total financial impact >$50
- 2 different approaches attempted and both failed
