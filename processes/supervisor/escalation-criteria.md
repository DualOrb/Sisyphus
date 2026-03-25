---
agent: supervisor
trigger: escalation_check
priority: critical
version: "1.0"
---

# Process: Escalation Criteria — When to Involve Humans

## Trigger

Evaluated continuously by all agents. Any agent can escalate by calling `request_clarification` with the appropriate urgency level. The supervisor also evaluates escalation criteria when reviewing sub-agent reports and during triage.

## Prerequisites

Before escalating, verify the situation warrants it:
- [ ] `get_entity_timeline("order", order_id, hours=1)` — confirm no human is already handling this
- [ ] `query_tickets({ orderId: order_id, status: ["New", "Pending"] })` — check for existing tickets
- [ ] Review the specific escalation category below to confirm the threshold is met

## Escalation Categories

### Category 1: SAFETY — Immediate, Always Escalate

**Urgency:** `critical`
**Response time:** Escalate within 30 seconds of detection. Do not attempt resolution.

Triggers:
- Driver reports an accident, injury, or vehicle incident
- Customer reports feeling unsafe (threatening driver, unsafe delivery location)
- Food safety concern (contamination, allergen exposure, spoilage)
- Driver appears incapacitated (no response after 3 follow-ups on an active delivery)
- Any mention of a minor or vulnerable person in distress
- Driver reports being under the influence or unsafe to drive

Actions:
1. Call `request_clarification({ urgency: "critical", category: "safety", context: {...} })`
2. If an active order is involved, call `execute_action("AddTicketNote", { note: "SAFETY ESCALATION: [details]" })`
3. Do NOT attempt to resolve, reassign, or close anything — wait for human

### Category 2: FINANCIAL — Above Autonomy Threshold

**Urgency:** `high`
**Response time:** Escalate within 2 minutes.

Triggers:
- Refund or credit request where `OrderTotal >= 2500` (i.e., >= $25.00 — values are in cents)
- Customer disputing a charge over 2500 cents
- Driver requesting compensation above 2500 cents
- Any action that would result in a net financial loss exceeding 2500 cents
- Multiple refunds to the same customer within 24 hours totaling over 5000 cents

Actions:
1. Complete your investigation first — gather order details, timeline, cause
2. Call `request_clarification({ urgency: "high", category: "financial", recommended_action: "...", amount_cents: N })`
3. Include your recommendation and reasoning so the human can approve quickly
4. Stage the action (do not execute) — human will approve or modify

### Category 3: LEGAL / MEDIA THREAT

**Urgency:** `critical`
**Response time:** Escalate within 1 minute. Stop all automated communication.

Triggers:
- Customer or driver mentions lawyer, lawsuit, legal action, or attorney
- Customer threatens to contact media, post on social media, or "go public"
- Customer references health department, food inspection, or regulatory body
- Any mention of a police report related to the service

Actions:
1. Immediately stop sending automated messages to this customer or driver
2. Call `request_clarification({ urgency: "critical", category: "legal_media", context: {...} })`
3. Do NOT apologize, admit fault, or offer compensation — these can have legal implications
4. Log all context for the human dispatcher

### Category 4: DRIVER SAFETY CONCERN

**Urgency:** `critical`
**Response time:** Escalate within 1 minute.

Triggers:
- Driver has not responded to 3 follow-ups during an active delivery
- Driver's last known location has not updated in 15+ minutes during an active delivery
- Driver reports road hazard, severe weather danger, or vehicle breakdown
- Driver sends a message suggesting distress or emergency

Actions:
1. Call `request_clarification({ urgency: "critical", category: "driver_safety" })`
2. Include driver's last known location, active order details, and message history
3. Human dispatcher may need to call the driver directly or contact emergency services

### Category 5: SYSTEM ANOMALY

**Urgency:** `high`
**Response time:** Escalate within 2 minutes.

Triggers:
- An ontology action returns `COOLDOWN_BLOCKED` or execution failure 3+ times in a row
- All drivers in a market show as offline simultaneously
- Multiple restaurants in the same zone report tablet offline (`LastHeartbeat` stale > 5 min)
- 3+ unassigned orders simultaneously with 0 available drivers in the zone
- `MarketMeters.Score` = 100 across multiple markets at the same time
- Redis connection failure or PostgreSQL unreachable

Actions:
1. Call `request_clarification({ urgency: "high", category: "system_anomaly", details: "..." })`
2. Stop taking automated actions in the affected zone until a human confirms the system state
3. Continue monitoring other unaffected zones normally

### Category 6: OUTSIDE OPERATING AUTHORITY

**Urgency:** `normal`
**Response time:** Escalate within 5 minutes.

Triggers:
- Driver asking about pay, scheduling policy, or contract terms
- Customer asking about account deletion, data privacy, or corporate complaints
- Request to change restaurant commission rates or delivery zone boundaries
- Any request involving employee HR matters
- Requests that require accessing systems outside the ontology layer

Actions:
1. Acknowledge the request: "I'll connect you with someone who can help with that."
2. Call `request_clarification({ urgency: "normal", category: "outside_authority" })`
3. Do not guess or provide unofficial answers on policy matters

## Escalation Format

Every escalation must include:
- **Category**: One of the six above
- **Urgency**: `critical`, `high`, or `normal`
- **Entity IDs**: Relevant `OrderId`, `DriverId`, `IssueId`
- **Summary**: 1-2 sentence description of the situation
- **Investigation**: What you already checked and found
- **Recommendation**: What you would do if you had authority (for categories 2 and 6)

## Logging

All escalations are automatically logged by the ontology action layer when `request_clarification` is called. The audit record includes the full context payload, urgency, and timestamp.
