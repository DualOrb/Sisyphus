---
agent: supervisor
trigger: new_event
priority: critical
version: "1.0"
---

# Process: Event Triage & Priority Assignment

## Trigger

When any new event arrives in the system — new order, driver message, ticket update, market alert, or sub-agent escalation. The supervisor evaluates every event through this triage process before delegating.

## Prerequisites

Before triaging, gather current system state:
- [ ] `query_orders({ status: "Pending" })` — check for unassigned orders
- [ ] `query_tickets({ status: "New" })` — check for unhandled tickets
- [ ] `query_drivers({ isAvailable: true })` — check driver availability

## Decision Tree

### Priority 1: SAFETY (handle immediately, escalate to human simultaneously)

Conditions:
- Event mentions driver accident, injury, or vehicle incident
- Event mentions customer safety concern (e.g. threatening driver, unsafe location)
- Event mentions food safety issue (e.g. contamination, allergen exposure)
- Event involves a minor or vulnerable person

Actions:
1. Call `request_clarification` with urgency "critical" to alert human dispatchers
2. If an active order is involved, call `execute_action("EscalateTicket", ...)` to create an escalated record
3. Do NOT attempt to resolve safety issues autonomously — always involve a human

### Priority 2: CUSTOMER-FACING (handle within 2 minutes)

Conditions:
- Unassigned order older than 3 minutes
- Order marked late (`isLate: true`) with no active intervention
- Customer ticket with status "New" about an active order
- Missing items or wrong order report on an in-progress delivery
- Customer requesting cancellation of an active order

Actions:
1. For unassigned orders → check available drivers, delegate to Driver Comms for assignment
2. For late orders → get order details, delegate to Driver Comms to check on driver
3. For new tickets about active orders → delegate to Customer Support Agent
4. For cancellation requests → delegate to Customer Support Agent (CancelOrder is RED tier)

### Priority 3: DRIVER COMMUNICATION (handle within 5 minutes)

Conditions:
- New incoming driver message (not yet responded to)
- Driver has not confirmed assignment after 3 minutes
- Driver follow-up overdue (follow-up sent, no response after cooldown)
- Driver reporting an issue (address problem, restaurant closed, etc.)

Actions:
1. Delegate all driver messaging to the Driver Comms Agent
2. Package context: driver info, assigned orders, conversation history, recent timeline
3. If driver has 3+ unanswered follow-ups → flag for supervisor attention after delegation

### Priority 4: MARKET HEALTH (handle within 10 minutes)

Conditions:
- Market Monitor raises a driver shortage alert (driverGap > 2 in any zone)
- Average ETA exceeds 25 minutes in any zone
- Driver-to-order ratio drops below 1.0 in any zone
- Multiple restaurants showing tablet offline in the same zone
- Order volume spike detected (>2x normal for time of day)

Actions:
1. Review Market Monitor's alert details
2. If driver shortage → check adjacent zones for available drivers, consider zone adjustments
3. If high ETAs → identify bottleneck (restaurant prep? driver supply? distance?)
4. If restaurant offline → delegate to Task Executor to pause affected restaurants
5. If surge → alert human dispatchers for potential staffing action

### Priority 5: ADMINISTRATIVE (handle when no higher-priority work pending)

Conditions:
- Restaurant information update request
- Menu item toggle request
- Scheduled maintenance task
- Report generation or data cleanup
- Sub-agent completed task (acknowledgment)

Actions:
1. Delegate to Task Executor for restaurant/menu updates
2. Acknowledge completed tasks and update tracking
3. Defer if any Priority 1-4 items are pending

## Conflict Resolution

When multiple events arrive simultaneously at the same priority level:

1. Within Priority 2 (customer-facing): Oldest unassigned order first, then oldest unresolved ticket
2. Within Priority 3 (driver comms): Messages about active deliveries first, then general messages
3. Within Priority 4 (market health): Zones with the lowest driver-to-order ratio first

## Re-evaluation

After completing any task, re-run triage:
1. Check if the action changed the priority landscape
2. Check if any deferred items have escalated in urgency (e.g., an unassigned order is now 5 minutes old)
3. Check sub-agent status — any stuck or escalated?

## Escalation to Human

Escalate to a human dispatcher (via `request_clarification` with urgency "critical" or "high") if:
- Any safety issue (always)
- 3+ unassigned orders simultaneously with no available drivers
- System-wide anomaly (all drivers offline, all restaurants showing errors)
- Sub-agent is stuck and re-delegation hasn't helped
- Financial impact of a decision exceeds $50
- You have attempted 2 different approaches to a problem and both failed
