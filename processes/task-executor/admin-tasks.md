---
agent: task-executor
trigger: admin_request
priority: low
version: "1.0"
---

# Process: General Administrative Tasks

## Trigger

When any agent requests an administrative action that does not fit into the specific categories of `restaurant-updates.md` or `menu-management.md`. This is the catch-all process for miscellaneous admin operations. The Task Executor handles these as a shared utility callable by any agent.

Common triggers:
- Supervisor delegates a zone or market configuration change
- Customer Support needs a delivery zone adjusted for a specific area
- Market Monitor detects a market setting that needs modification
- Batch operations during quiet periods
- Data cleanup or correction tasks

## Prerequisites

Before performing any admin task, gather context:
- [ ] Understand the request: which agent is asking, what exactly needs to change, and why
- [ ] `get_entity_timeline` for the affected entity -- check for recent changes to avoid conflicts
- [ ] Verify the requesting agent has provided a reason (ticket ID, monitoring alert, or supervisor directive)
- [ ] Check if the change will have downstream effects on other entities

## Types of Admin Tasks

### 1. Update Delivery Zones

Modify the boundaries or properties of a delivery zone (market).

**Examples:**
- Expanding a delivery zone to cover a new area
- Shrinking a zone that has coverage problems
- Adjusting zone overlap between adjacent markets

**Verification steps:**
1. **Source verification:** Zone changes should come from the supervisor or a human directive -- not from sub-agents independently
2. **Impact assessment:** How many restaurants and drivers are affected?
   - `query_restaurants({ deliveryZone: "{zone}" })` -- restaurants in the zone
   - `query_drivers({ dispatchZone: "{zone}" })` -- drivers assigned to the zone
3. **Active order check:** Are there active orders in the affected area?
   - `query_orders({ deliveryZone: "{zone}", status: ["Pending", "Confirmed", "Ready", "EnRoute"] })`
4. **Adjacent zone check:** Will this change create a coverage gap or overlap?

**Action:**
```
execute_action("UpdateDeliveryZone", {
  market: "...",
  field: "...",
  value: "...",
  reason: "Zone adjustment per supervisor directive. Expanding {zone} to cover {area}."
})
```

**Tier:** YELLOW for minor adjustments. RED for changes that affect multiple restaurants or remove coverage from an area.

### 2. Modify Market Settings

Adjust market-level configuration values.

**Examples:**
- Adjusting ETA calculation parameters
- Modifying surge thresholds for a specific market
- Updating market operating hours
- Changing driver assignment radius

**Verification steps:**
1. Confirm the change is authorized by the supervisor or human dispatcher
2. Check current market health: `query_market_health({ market: "{MarketName}" })` -- ensure the change won't worsen an already struggling market
3. Document the current value before changing

**Action:**
```
execute_action("UpdateMarketSetting", {
  market: "...",
  setting: "...",
  value: "...",
  previousValue: "...",
  reason: "Market setting adjusted per {source}. Previous: {old}, new: {new}."
})
```

### 3. Bulk Operations

Operations that affect multiple entities at once.

**Examples:**
- Disabling all restaurants in a zone (weather emergency, power outage)
- Updating delivery fees across a market
- Resetting driver availability flags after a system glitch

**Verification steps:**
1. **Always escalate bulk operations to the supervisor first** -- do not execute bulk changes on sub-agent request alone
2. Enumerate the affected entities and present the count to the supervisor
3. If the operation affects more than 5 entities, stage it for human approval (treat as RED tier)
4. Process entities one at a time so each action is individually audited

**Execution pattern:**
```
# For each affected entity:
execute_action("{ActionName}", {
  entityId: "...",
  field: "...",
  value: "...",
  reason: "Bulk operation: {description}. Entity {N} of {total}."
})
```

After completion, log a summary:
```
execute_action("AddTicketNote", {
  ticketId: "...",
  note: "BULK OPERATION COMPLETE: {description}. Affected {N} entities in {MarketName}. Reason: {reason}."
})
```

### 4. Data Correction

Fixing data that is incorrect or inconsistent.

**Examples:**
- Restaurant phone number is wrong
- Driver's delivery area doesn't match their actual zone
- Order has an incorrect status that wasn't updated by the system

**Verification steps:**
1. Document what the current (incorrect) value is
2. Verify the correct value from a reliable source
3. Check if the incorrect data has affected any active orders or tickets
4. Log both old and new values in the audit trail

**Important:** Sisyphus should only correct data in tables it is authorized to write to (see `11-ontology-data-mapping.md` Section 2, Write Path). Never write directly to DynaClone -- it is read-only.

## Always Log What Was Changed and Why

Every admin task must include in its `reasoning` string:
1. **What** was changed (entity, field, old value, new value)
2. **Why** it was changed (ticket reference, alert, supervisor directive)
3. **Who** requested it (which agent or human)
4. **Impact** assessment (how many other entities are affected)

Example reasoning:
```
"Updated DeliveryZone boundary for Perth market to include Lanark County area.
Requested by supervisor due to new restaurant onboarding.
Affects 0 active orders, 3 drivers will see expanded zone.
Source: supervisor directive following ticket #abc123."
```

## Escalation: Multi-Entity Changes

**Any task that affects multiple restaurants or markets must be escalated before execution.**

If the admin task would modify:
- 2+ restaurants simultaneously -> escalate to supervisor for confirmation
- 2+ markets simultaneously -> escalate to supervisor AND stage for human approval
- Any market-wide setting -> supervisor approval required
- Driver assignment rules -> supervisor approval required

```
request_clarification({
  urgency: "normal",
  category: "admin_approval",
  action: "{what needs to happen}",
  scope: "{N} restaurants / {N} markets affected",
  recommendation: "{your recommendation}",
  reasoning: "{why this change is needed}"
})
```

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `UpdateDeliveryZone` | YELLOW / RED | Modifying zone boundaries or settings |
| `UpdateMarketSetting` | YELLOW | Adjusting market configuration |
| `UpdateRestaurant` | YELLOW | One-off restaurant data correction |
| `UpdateMenuItem` | YELLOW | One-off menu data correction |
| `AddTicketNote` | GREEN | Documenting admin task completion |
| `LogShiftEvent` | GREEN | Recording significant admin operations |
| `request_clarification` | -- | Seeking approval for multi-entity changes |

## Cooldown Rules

| Action | Minimum Wait | Notes |
|--------|-------------|-------|
| Same entity, same field | 5 minutes | Prevent rapid toggling |
| Bulk operation (same scope) | 15 minutes | Allow time to verify results |
| Zone boundary change | 30 minutes | Significant change needs time to take effect |

## Escalation

Escalate to supervisor if:
- Task affects multiple restaurants or markets (always)
- Task involves financial settings (delivery fees, commission rates)
- The request source is unclear or unverified
- The change would remove service from an area with active orders
- You are unsure whether the change is appropriate
- The task requires access to systems outside the ontology layer

## Audit Requirements

Every admin action is logged by the ontology action layer with:
- Entity type and ID
- Field changed, old value, new value
- Reason string (must be comprehensive for admin tasks -- see above)
- Requesting agent and authorization source
- Timestamp

Admin tasks are flagged for review in the shift summary due to their potential for wide-reaching impact.
