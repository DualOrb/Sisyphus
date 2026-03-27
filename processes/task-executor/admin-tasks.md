---
agent: task-executor
trigger: admin_request
priority: low
version: "1.0"
---

# General Administrative Tasks

**Trigger:** Any agent requests an admin action not covered by specific restaurant/menu processes (zone changes, market settings, bulk ops, data corrections).

**Check First:**
- Which agent is requesting and why (ticket ID, alert, or supervisor directive)
- Entity timeline for recent changes to avoid conflicts
- Downstream effects on other entities

**Steps:**
1. **Delivery zone changes:** verify source is supervisor or human directive. Assess impact (restaurants, drivers, active orders in zone). YELLOW for minor adjustments; RED if affects multiple restaurants or removes coverage.
2. **Market settings:** confirm authorized by supervisor/human. Document current value before changing.
3. **Bulk operations:** always escalate to supervisor first. Enumerate affected entities. >5 entities = stage for human approval (RED). Process one at a time for audit trail.
4. **Data corrections:** document old and new values. Only write to authorized tables (never DynaClone -- read-only). Check if incorrect data affected active orders.
5. Every admin task reasoning must include: what changed, why, who requested, impact assessment.

**Escalate If:**
- Task affects 2+ restaurants or 2+ markets simultaneously
- Involves financial settings (delivery fees, commissions)
- Request source is unclear or unverified
- Change would remove service from area with active orders
- Requires access to systems outside ontology layer
- You are unsure whether the change is appropriate
