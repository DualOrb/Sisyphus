# Sisyphus: Agent Design & Process Framework

**Date:** 2026-03-25
**Status:** Planning

---

## 1. Agent Hierarchy

```
                    ┌───────────────────────┐
                    │   SUPERVISOR AGENT    │
                    │   "The Dispatcher"    │
                    │                       │
                    │  - Triage & priority  │
                    │  - Delegation         │
                    │  - Escalation         │
                    │  - Global awareness   │
                    └───────────┬───────────┘
                                │
            ┌───────────────────┼───────────────────┐
            │                   │                   │
   ┌────────▼────────┐ ┌───────▼────────┐ ┌───────▼────────┐
   │  MARKET MONITOR │ │  DRIVER COMMS  │ │   CUSTOMER     │
   │  AGENT          │ │  AGENT         │ │   SUPPORT      │
   │                 │ │                │ │   AGENT        │
   │  - Health scores│ │  - Messaging   │ │                │
   │  - Driver/order │ │  - Follow-ups  │ │  - Tickets     │
   │    ratios       │ │  - Assignment  │ │  - Refunds     │
   │  - Proactive    │ │    issues      │ │  - Escalation  │
   │    alerts       │ │  - Shift mgmt  │ │  - Resolution  │
   └────────┬────────┘ └───────┬────────┘ └───────┬────────┘
            │                  │                   │
            └──────────────────┼───────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   TASK EXECUTOR     │
                    │   (Shared Utility)  │
                    │                     │
                    │  - Menu updates     │
                    │  - Restaurant edits │
                    │  - Admin tasks      │
                    │                     │
                    │  Callable by ANY    │
                    │  agent above        │
                    └─────────────────────┘
```

> **Task Executor is a shared utility, not a peer.** Any sub-agent (or the supervisor)
> can invoke it directly when they need an admin task done as part of their work. This
> avoids round-tripping through the supervisor for routine operations like toggling a
> menu item or pausing a restaurant. The ontology guardrails still apply — every Task
> Executor action goes through submission criteria, tiers, and audit.

---

## 2. Agent Definitions

### 2.1 Supervisor Agent (The Dispatcher)

**Role**: Central coordinator. Mirrors a senior dispatcher's decision-making.

**Responsibilities**:
- Continuously polls for new events (orders, messages, tickets, alerts)
- Evaluates priority of each event
- Delegates to appropriate sub-agent with context
- Monitors sub-agent progress
- Handles escalations from sub-agents
- Maintains awareness of overall market health
- Decides what to focus on vs. defer

**Process files loaded**: All files (has global awareness)

**LangGraph Node Type**: Supervisor (uses `create_supervisor`)

**Decision loop** (simplified):
```
every 30 seconds:
  1. Check market health (via Market Monitor)
  2. Check for new driver messages
  3. Check for new/updated support tickets
  4. Check for unassigned orders
  5. Check sub-agent status (stuck? completed? escalated?)
  6. Prioritize and act on highest-priority item
```

### 2.2 Market Monitor Agent

> **DEPRECATED**: Market Monitor agent was removed. Market health monitoring is now the Supervisor's responsibility. This section is retained for historical reference only.

**Role**: The "eyes on the dashboard" agent. Watches everything, flags anomalies.

**Responsibilities**:
- Poll dispatch snapshot (S3) every 30-60 seconds
- Calculate market health scores per zone
- Detect: unassigned orders, low driver counts, high ETAs, driver conflicts
- Flag proactive issues to supervisor before they become problems
- Track trends (is the market getting better or worse?)

**Key metrics watched**:
| Metric | Alert Threshold | Action |
|--------|----------------|--------|
| Unassigned orders | > 0 for 3+ min | Escalate to supervisor |
| Driver-to-order ratio | < 1.0 | Flag staffing concern |
| Average ETA | > 25 min | Flag market slowdown |
| Driver offline rate | > 30% | Proactive alert |
| Order volume spike | > 2x normal | Prepare for surge |

**Process files loaded**: `market-monitoring.md`, `surge-handling.md`, `staffing-alerts.md`

### 2.3 Driver Comms Agent

**Role**: Handles all communication with drivers.

**Responsibilities**:
- Respond to incoming driver messages
- Send assignment notifications and follow-ups
- Check in with drivers who haven't confirmed orders
- Handle driver complaints and issues
- Coordinate reassignments

**Key behaviors**:
- **Ontology-first**: Queries `Conversation` and `Message` objects for context, calls `SendDriverMessage` action to respond
- **Cooldown enforced**: Ontology layer blocks actions if cooldown hasn't elapsed — agent doesn't need to remember
- **Context aware**: Uses `get_entity_timeline()` tool to see full interaction history before responding
- **Tone**: Professional but friendly (defined in process files)
- **Escalation**: Routes issues it can't resolve to supervisor via `request_clarification()` tool

**Process files loaded**: `driver-messaging.md`, `assignment-followup.md`, `driver-issues.md`

### 2.4 Customer Support Agent

**Role**: Resolves support tickets end-to-end.

**Responsibilities**:
- Pick up new/open support tickets (queries `Ticket` objects filtered by status)
- Investigate the issue (traverses `Ticket → Order → Driver/Restaurant/Customer` links)
- Apply resolution via ontology actions (`ResolveTicket`, `AddTicketNote`, `EscalateTicket`)
- Communicate with customer
- Close ticket with resolution notes

**Key behaviors**:
- **Ontology-first**: Traverses object links to build full picture before deciding
- **Tiered autonomy**: Small refunds (<$25) are ORANGE tier (auto after ramp-up), large refunds are RED (always human-approved)
- **Audit-rich**: Every resolution logged with reasoning, before/after ticket state

**Process files loaded**: `ticket-resolution.md`, `refund-policy.md`, `customer-communication.md`, `escalation-criteria.md`

### 2.5 Task Executor Agent (Shared Utility)

**Role**: The "hands" agent. Performs administrative tasks that any other agent might need done during its work.

**Callable by**: Supervisor, Market Monitor, Driver Comms, Customer Support — any agent.

**Responsibilities**:
- Update restaurant information (hours, contact, status)
- Modify menu items (toggle availability, update prices)
- Pause/unpause restaurants
- Adjust delivery zones
- Process bulk updates
- Execute any admin action delegated by another agent

**Why shared (not supervisor-only)**:
- Driver Comms discovers a restaurant is sending drivers to the wrong address → calls Task Executor to update it, without breaking context by escalating to supervisor
- Customer Support resolves a ticket about a wrong menu item → calls Task Executor to disable it as part of the resolution
- Market Monitor sees a restaurant is offline but still receiving orders → calls Task Executor to pause it

**Guardrails**: Same ontology-layer protections as all other actions. Being callable by any agent doesn't mean uncontrolled — submission criteria, tiers, cooldowns, and audit all apply.

**Process files loaded**: `restaurant-updates.md`, `menu-management.md`, `admin-tasks.md`

---

## 3. Process .md File Structure

### 3.1 Directory Layout

```
/Volumes/Macxtra/ValleyEats/Sisyphus/
  processes/
    AGENTS.md                          # Master: system overview, global rules

    supervisor/
      triage-priority.md               # How to prioritize events
      escalation-criteria.md           # When to escalate to humans
      shift-start.md                   # Beginning-of-shift procedures
      shift-end.md                     # End-of-shift handoff

    market-monitor/
      market-health.md                 # Health score thresholds and responses
      surge-handling.md                # What to do during order surges
      staffing-alerts.md               # Driver shortage procedures

    driver-comms/
      driver-messaging.md             # Tone, templates, conversation rules
      assignment-followup.md          # Following up on unconfirmed assignments
      driver-issues.md                # Handling driver complaints/problems
      no-response-protocol.md         # What to do when a driver doesn't respond

    customer-support/
      ticket-resolution.md            # Step-by-step ticket handling
      refund-policy.md                # When and how much to refund
      customer-communication.md       # Tone, templates, escalation
      late-delivery.md                # Specific: late delivery resolution
      missing-items.md                # Specific: missing items resolution
      wrong-order.md                  # Specific: wrong order resolution

    task-executor/
      restaurant-updates.md           # How to update restaurant info
      menu-management.md              # How to modify menus
      admin-tasks.md                  # General admin procedures
```

### 3.2 Process File Template

Each process file follows this structure:

```markdown
---
agent: driver-comms
trigger: new_driver_message
priority: normal
version: 1.0
---

# Process: Responding to Driver Messages

## Trigger
When a new message arrives from a driver via WebSocket `new_message` event.

## Prerequisites
Before responding, gather context via ontology tools:
- [ ] `get_order_details(driver.assigned_orders)` — driver's current active orders
- [ ] `get_entity_timeline("driver", driver_id, hours=2)` — recent interactions
- [ ] `query_messages(driver_id, limit=10)` — conversation history
- [ ] `query_tickets(filters={driver_id, status=["Open","InProgress"]})` — open issues

Note: Cooldown is enforced by the ontology action layer — you don't need to check manually.
If you try to call `SendDriverMessage` too soon, it will return a `COOLDOWN_BLOCKED` result
with `seconds_remaining`.

## Decision Tree

### If the message is about an order issue:
1. Identify the order — query `Order` objects linked to this driver
2. Check `Order.status` and `Order.is_late` computed property
3. If order is late → follow `late-delivery.md`
4. If driver can't find customer → provide `Order.delivery_address` and `Customer.notes`
5. If driver needs to cancel → call `request_clarification()` to escalate to supervisor

### If the message is a status update:
1. Acknowledge the update
2. No further action needed unless status is concerning

### If the message is a complaint or request:
1. Acknowledge empathetically
2. If within your authority → resolve directly
3. If not → escalate to supervisor with context

## Response Rules
- Maximum 2 messages before waiting for driver response
- Minimum 3 minutes between unsolicited messages
- Always reference the specific order when applicable
- Keep messages under 160 characters when possible (SMS-friendly)
- Use driver's first name

## Cooldown Rules
| Action | Minimum Wait | Max Attempts |
|--------|-------------|--------------|
| Reply to driver message | 0 (immediate OK) | — |
| Follow-up (no response) | 5 minutes | 3 |
| Assignment reminder | 3 minutes | 2 |
| Unsolicited check-in | 15 minutes | 1 |

## Escalation
Escalate to supervisor if:
- Driver is threatening or abusive
- Issue involves safety
- 3 follow-ups with no response
- Issue requires order cancellation or reassignment
- Financial impact > $50

## Actions Available
| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `SendDriverMessage` | YELLOW | Responding to driver, sending instructions |
| `FollowUpWithDriver` | YELLOW | No response after cooldown elapsed |
| `ReassignOrder` | YELLOW | Driver can't complete delivery |
| `EscalateTicket` | GREEN | Issue beyond your authority |
| `AddTicketNote` | GREEN | Documenting investigation |

## Logging
Handled automatically by the ontology action layer. Every `execute_action()` call creates
an immutable audit record with: action type, params, agent reasoning, before/after state,
outcome, and timestamp. No manual logging needed.
```

### 3.3 AGENTS.md (Master File)

```markdown
# Sisyphus — AI Dispatcher System

## System Identity
You are Sisyphus, an AI dispatcher for ValleyEats. You operate the dispatch
interface during business hours, handling the same responsibilities as a
human dispatcher.

## Global Rules
1. **Never lie** to drivers or customers. If you don't know, say so.
2. **Use ontology tools only.** Query objects and call actions — never construct raw API calls or browser commands.
3. **Trust the guardrails.** Cooldowns, rate limits, and submission criteria are enforced by the ontology layer. If an action is blocked, respect the reason and adjust.
4. **Escalate when uncertain.** It's better to call `request_clarification()` than to make a mistake.
5. **Customers come first.** When prioritizing, customer-facing issues win.
6. **Be concise.** Messages should be clear and brief.
7. **Provide reasoning.** When calling `execute_action()`, always include a clear `reasoning` string explaining why you chose this action. This is logged to the audit trail.

## Priority Order
1. Safety issues (always immediate)
2. Customer-facing problems (orders at risk)
3. Driver communication (responses and follow-ups)
4. Market health issues (proactive monitoring)
5. Administrative tasks (lowest priority)

## Delegation
- Route messages to Driver Comms Agent
- Route tickets to Customer Support Agent
- Market monitoring runs continuously in background
- Supervisor handles anything that doesn't fit or requires coordination
- Task Executor is a shared utility — any agent (including supervisor) can call it
  directly for admin tasks like updating restaurants, toggling menu items, etc.
```

---

## 4. Delegation & Context Sharing

### 4.1 How the Supervisor Delegates

LangGraph's supervisor pattern:

```
Supervisor receives event
    │
    ├── Evaluates: which sub-agent handles this?
    │   (uses triage-priority.md decision tree)
    │
    ├── Packages context:
    │   {
    │     task_id: "unique-id",
    │     event_type: "new_driver_message",
    │     entity_id: "driver-123",
    │     related_orders: ["order-456"],
    │     conversation_history: [...],
    │     recent_actions: [...from Redis...],
    │     process_file: "driver-messaging.md",
    │     priority: "normal",
    │     delegated_at: "2026-03-25T14:30:00Z"
    │   }
    │
    └── Passes to sub-agent node in LangGraph graph
```

### 4.2 Shared Context Between Agents

All agents share state through LangGraph's centralized state object. The ontology provides the structured world model within that state:

```python
class SisyphusState(TypedDict):
    # === Ontology State (the world model) ===
    ontology: OntologyState              # All synced objects, queryable by agents

    # === Global (all agents see this) ===
    current_market_health: dict          # Per-zone health scores (computed from ontology)
    active_tasks: list[Task]             # All in-progress tasks
    recent_audit: list[AuditRecord]      # Last N action audit records

    # === Per-task context (set by supervisor when delegating) ===
    current_task: Task                   # The task this agent is working on
    task_context: dict                   # Pre-fetched related objects from ontology

    # === Agent communication ===
    messages: list[AgentMessage]         # Inter-agent messages
    escalations: list[Escalation]        # Items escalated to supervisor
```

Agents access the ontology via tools (see `09-ontology-layer-design.md` Section 7):
- `query_orders()`, `query_drivers()`, etc. — read from ontology state
- `get_order_details()` — get object with all linked objects resolved
- `get_entity_timeline()` — recent actions/events for an entity
- `execute_action()` — call a named action (validated, audited, routed to executor)
- `request_clarification()` — ask supervisor or human for help

### 4.3 Preventing Conflicts

When multiple agents might touch the same entity (e.g., two tickets about the same order):

1. **Redis locks**: `SET lock:order:{order_id} {agent_id} NX EX 600`
2. **Lock check before action**: Agent checks if another agent holds the lock
3. **If locked**: Agent reports back to supervisor, which coordinates
4. **Lock release**: Automatic via TTL, or explicit on task completion

---

## 5. LangGraph Graph Structure

```typescript
// Simplified graph definition (LangGraph.js)

import { StateGraph, Annotation } from "@langchain/langgraph";
import { createSupervisor } from "@langchain/langgraph-supervisor";

// Ontology tools — shared by all agents, validated at the ontology layer
const ontologyTools = [
  queryOrders,          // Query Order objects with filters
  queryDrivers,         // Query Driver objects with filters
  queryTickets,         // Query Ticket objects with filters
  getOrderDetails,      // Get order with all linked objects
  getEntityTimeline,    // Recent actions/events for an entity
  executeAction,        // Call a named action (validated, audited)
  requestClarification, // Escalate to supervisor or human
];

// Task Executor is a shared utility — wrapped as a callable tool
const taskExecutorTool = wrapAgentAsTool(
  taskExecutorAgent,
  "task_executor",
  "Perform admin tasks: update restaurants, toggle menu items, pause/unpause, etc.",
);

const allTools = [...ontologyTools, taskExecutorTool];

// Build the supervisor graph
const graph = createSupervisor({
  agents: [marketMonitorAgent, driverCommsAgent, customerSupportAgent],
  model: llm,
  systemPrompt: loadProcessFile("AGENTS.md"),
  tools: allTools,  // Supervisor and all agents get ontology + task executor access
});

// Compile with checkpointing
const app = graph.compile({
  checkpointer: new PostgresSaver(pool),
});
```

> **Note:** Each `executeAction()` call goes through the ontology layer which validates
> submission criteria, checks cooldowns, enforces autonomy tiers, and routes to the
> appropriate executor (browser or API). The agent just says *what* to do; the ontology
> handles *how* and *whether* it's allowed.

---

## 6. Process File Loading & Hot-Reload

Process .md files are loaded at shift start and can be reloaded without restarting:

1. **At shift start**: All process files parsed and stored in agent system prompts
2. **YAML frontmatter**: Parsed for metadata (agent assignment, trigger conditions, priority)
3. **Hot-reload**: A file watcher detects changes to `processes/` directory
4. **On change**: Affected agent's system prompt is rebuilt with updated process content
5. **Version tracking**: Git tracks all changes to process files for audit

This means business logic can be updated by editing a markdown file — no code deployment needed.

---

## 7. Human Override & Handoff

### Taking Over from Sisyphus

A human dispatcher can override Sisyphus at any point:

1. **Claim a task**: Human clicks on an order/ticket Sisyphus is working on
2. **Lock transfer**: Sisyphus detects (via presence or lock check) that a human has taken over
3. **Graceful handoff**: Sisyphus stops working that task, logs a handoff note
4. **Context preserved**: All of Sisyphus's investigation and actions are in the activity log

### Sisyphus Requesting Human Help

When Sisyphus encounters something outside its authority or confidence:

1. Agent triggers escalation (per process file criteria)
2. Escalation logged with full context (what was tried, why it's being escalated)
3. Notification sent to dispatch UI (bulletin or in-app alert)
4. Task remains in "escalated" state until human picks it up

---

## 8. Error Handling Philosophy

| Situation | Response |
|-----------|----------|
| Unsure what to do | Escalate to supervisor → escalate to human |
| Action blocked by ontology | Respect the guardrail (cooldown, criteria, tier); adjust approach or escalate |
| Execution failed (browser/API error) | Ontology retries once → if still fails, log and escalate |
| LLM returned nonsensical output | Discard, re-prompt with more context |
| Conflicting information | Gather more data before acting |
| Customer is angry/threatening | Immediately escalate to human |
| Driver safety concern | Immediately alert + escalate |
| Process file missing | Fall back to supervisor's general judgment |
