# Sisyphus: System Architecture Plan

**Project:** AI Dispatcher System for ValleyEats
**Codename:** Sisyphus
**Date:** 2026-03-25
**Status:** Planning

---

## 1. Vision

Sisyphus is an autonomous AI dispatcher that operates the ValleyEats dispatch system during business hours. It monitors markets, communicates with drivers, resolves support tickets, and takes proactive action on market health — exactly as a human dispatcher does.

**Core Principles:**

1. **Ontology-first.** Agents reason over typed objects (Orders, Drivers, Restaurants) and execute named Actions with built-in validation — never raw DOM or database rows. The ontology is the contract between AI and reality.
2. **Actions are the only way to change the world.** Every mutation goes through a registered Action Type with submission criteria, permission checks, cooldown enforcement, and audit logging.
3. **Visible through the dispatch UI.** Write actions execute through the browser so human dispatchers see Sisyphus working in real time via the existing websocket presence system. It appears as another dispatcher on the page.
4. **Graduated autonomy.** Actions are tiered GREEN → RED. Sisyphus starts supervised and earns autonomy as trust builds.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    TEMPORAL.IO (Durability Layer)                │
│              Manages shift lifecycle, crash recovery             │
│              Schedules: start/stop at business hours             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                 LANGGRAPH SUPERVISOR AGENT                       │
│                    (The Dispatcher)                              │
│                                                                 │
│    Reasons over Ontology objects, not raw data                  │
│    Delegates to specialized sub-agents                          │
│    Uses process .md files for decision-making                   │
│                                                                 │
│    ┌──────────┐  ┌──────────┐  ┌──────────┐                    │
│    │ Market   │  │ Driver   │  │ Customer │                    │
│    │ Monitor  │  │ Comms    │  │ Support  │                    │
│    │ Agent    │  │ Agent    │  │ Agent    │                    │
│    └────┬─────┘  └────┬─────┘  └────┬─────┘                    │
│         │             │             │                           │
│         └─────────────┼─────────────┘                           │
│              Any agent can invoke ▼                              │
│                  ┌──────────────┐                                │
│                  │ Task Executor│  (shared utility agent)        │
│                  │ Admin tasks  │                                │
│                  └──────────────┘                                │
│              Agents query objects & call actions ONLY            │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    ONTOLOGY LAYER (Semantic Core)                │
│         The structured world model between AI and reality       │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐     │
│  │  OBJECTS    │  │   ACTIONS    │  │   GUARDRAILS       │     │
│  │  Order      │  │  AssignDriver│  │  Submission criteria│     │
│  │  Driver     │  │  SendMessage │  │  Autonomy tiers    │     │
│  │  Customer   │  │  Reassign   │  │  Cooldown enforce  │     │
│  │  Restaurant │  │  Resolve    │  │  Rate limits       │     │
│  │  Ticket     │  │  Escalate   │  │  Circuit breaker   │     │
│  │  Zone       │  │  Cancel     │  │  Audit trail       │     │
│  └─────────────┘  └──────────────┘  └────────────────────┘     │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    EXECUTION LAYER                               │
│         Translates ontology actions into real-world effects     │
│                                                                 │
│  ┌──────────────────┐       ┌──────────────────────────┐       │
│  │  Browser Executor │       │  API Executor            │       │
│  │  (browser-use)    │       │  (REST calls)            │       │
│  │  Visible actions  │       │  High-frequency reads    │       │
│  └────────┬─────────┘       └──────────┬───────────────┘       │
│           ▼                            ▼                        │
│     Headless Chrome              Dispatch REST API              │
│     (dispatch UI)                (AWS Lambda)                   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    STATE LAYER                                   │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐     │
│  │    Redis    │  │  PostgreSQL  │  │  LangGraph State  │     │
│  │  Cooldowns  │  │  Audit logs  │  │  Graph execution  │     │
│  │  Locks      │  │  History     │  │  Checkpoints      │     │
│  │  Cache      │  │  Summaries   │  │  Ontology sync    │     │
│  └─────────────┘  └──────────────┘  └───────────────────┘     │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    LLM INFERENCE LAYER                           │
│                                                                 │
│  ┌─────────────────────┐  ┌─────────────────────────┐          │
│  │  Local (AMD Halo)   │  │  Cloud (OpenRouter)     │          │
│  │  llama.cpp / Vulkan │  │  Fallback / complex     │          │
│  │  Primary inference  │  │  reasoning tasks        │          │
│  └─────────────────────┘  └─────────────────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

> **Key architectural insight (inspired by Palantir AIP Ontology):** Agents never touch
> raw data, DOM elements, or API responses directly. They reason over typed objects and
> call named actions. The ontology layer validates, enforces guardrails, and routes to
> the execution layer. See `09-ontology-layer-design.md` for full details.

---

## 3. Integration with Existing Dispatch System

### 3.1 How Sisyphus Appears to Human Dispatchers

Sisyphus logs into the dispatch interface with its own Cognito account (position: `dispatcher` or `manager`). This means:

- **Presence**: Its avatar appears in the `PagePresenceFloater` — humans see "Sisyphus" as an active user
- **Actions are logged**: Every status change, driver assignment, and message goes through the existing activity log system with Sisyphus as the actor
- **Real-time visibility**: Other dispatchers see Sisyphus's current route/view via WebSocket presence updates (`presence_update` events)
- **Audit trail**: All actions are recorded in `ValleyEats-DispatchActivityLogs` with full context

### 3.2 Ontology-Mediated Action Model

Agents never interact with the browser or API directly. They call ontology tools. The ontology validates and routes to the appropriate executor:

```
Agent decides: "Reassign order #1234 to driver #567"
    │
    ▼
Calls: execute_action("ReassignOrder", {order_id: 1234, driver_id: 567, reason: "unresponsive"})
    │
    ▼
Ontology layer:
    ├── Check submission criteria (order not already picked up, driver available)
    ├── Check cooldown (order not reassigned in last 10 min)
    ├── Check autonomy tier (YELLOW → auto-execute, log prominently)
    ├── Check rate limit (< 20 reassignments/hour)
    │
    ▼
Execution layer routes to:
    ├── Browser Executor (visible actions: assignments, messages, status changes)
    │   └── browser-use navigates UI, clicks buttons, fills forms
    └── API Executor (background reads, notes, internal flags)
        └── Direct REST call to dispatch API
```

**Browser Executor** — for write actions that should be visible to human dispatchers in real time (assignments, messages, status changes, ticket resolutions)

**API Executor** — for high-frequency reads (polling orders/drivers/market data) and low-visibility writes (adding notes, internal flags)

The routing is configured per action type (see `09-ontology-layer-design.md` Section 8.3).

### 3.3 Existing Systems Leveraged

| System | How Sisyphus Uses It |
|--------|---------------------|
| **Dispatch REST API** | 38 Lambda endpoints for orders, drivers, messages, issues, etc. |
| **WebSocket** | Receives real-time driver messages, broadcasts its presence |
| **AI Insights** (`ValleyEats-AIDecisions`) | Reads existing AI market health insights to inform decisions |
| **Activity Logs** | All actions logged with Sisyphus as actor, linked to context |
| **Cognito Auth** | Authenticates as a dispatcher with appropriate permissions |
| **Amazon Connect** | Future: could handle phone calls (Phase 3+) |

---

## 4. Agent Hierarchy

### 4.1 Supervisor: The Dispatcher Agent

The top-level agent that mirrors what a human dispatcher does moment-to-moment:

- Continuously monitors the overall state of all markets
- Triages incoming events (new orders, driver messages, support tickets)
- Delegates to specialized sub-agents
- Makes escalation decisions
- Manages its own attention (what to focus on, what to defer)

### 4.2 Sub-Agents

| Agent | Responsibility | Trigger |
|-------|---------------|---------|
| **Market Monitor** | Watches market health scores, driver-to-order ratios, ETAs. Flags issues proactively. | Continuous polling, threshold alerts |
| **Driver Comms** | Handles all driver communication — responds to messages, sends instructions, follows up. | New driver message, assignment follow-up |
| **Customer Support** | Resolves support tickets — investigates issues, applies resolutions, communicates with customers. | New ticket, ticket escalation |
| **Task Executor** | Shared utility agent. Performs administrative tasks — updating restaurants, menu items, etc. Callable by any agent (not just supervisor). | Any agent delegation |

### 4.3 Delegation Flow

```
Event (new message, new ticket, market alert)
    │
    ▼
Supervisor evaluates priority and context
    │
    ├─── High priority → Handle immediately (or delegate with urgency)
    ├─── Normal → Queue and delegate to appropriate sub-agent
    └─── Low priority → Defer (add to background task queue)
          │
          ▼
    Sub-agent picks up task
          │
          ├─── Reads relevant process .md file
          ├─── Queries ontology objects for context
          ├─── Calls ontology actions (validated, audited, cooldown-enforced)
          ├─── Ontology routes to browser or API executor
          └─── Reports result to supervisor
```

---

## 5. Operating Model

### 5.1 Shift Lifecycle

```
Business Hours Start
    │
    ▼
Temporal triggers "start_shift" workflow
    │
    ▼
Launch Chrome container, authenticate Sisyphus
    │
    ▼
Supervisor agent initializes:
  - Load process .md files
  - Connect to Redis/Postgres
  - Sync ontology (populate objects from dispatch API)
  - Begin market monitoring loop
    │
    ▼
┌─── Main Loop ────────────────────────┐
│                                       │
│  1. Poll market state (every 30s)     │
│  2. Check for new events/messages     │
│  3. Triage and delegate               │
│  4. Process sub-agent results         │
│  5. Update presence/status            │
│                                       │
│  (Temporal checkpoints each cycle)    │
│                                       │
└───────────────────────────────────────┘
    │
    ▼
Business Hours End
    │
    ▼
Temporal triggers "end_shift" workflow
    │
    ▼
Graceful shutdown:
  - Complete in-progress tasks
  - Hand off open items (log summary)
  - Disconnect Chrome
  - Persist final state
```

### 5.2 Failure Recovery

- **Agent crash**: Temporal restarts the workflow from the last checkpoint
- **Chrome crash**: Chrome container restarts, agent re-authenticates
- **LLM timeout**: Falls back from local to OpenRouter, or retries
- **Network issues**: Temporal handles retry with exponential backoff
- **Stuck task**: Supervisor has timeout rules per task type; escalates or abandons

---

## 6. Security & Access Control

- Sisyphus gets its own Cognito user with `dispatcher` role permissions
- Permissions are the same as a human dispatcher (no backdoor access)
- All actions go through the same RBAC permission checks
- Admin can revoke Sisyphus's access at any time by disabling the Cognito account
- Rate limiting on actions to prevent runaway behavior
- Human override: any dispatcher can "take over" a task Sisyphus is working on

---

## 7. Observability

| What | How |
|------|-----|
| **What Sisyphus is doing right now** | Dispatch UI presence system shows its current view/route |
| **What actions it has taken** | Ontology audit trail (reasoning, params, before/after state) + dispatch activity logs |
| **Why it took an action** | Audit record includes LLM reasoning chain, process file referenced, context |
| **Agent health** | Temporal workflow status, Docker container health checks |
| **LLM performance** | Token usage, latency, and cost logged per inference call |
| **Error rate** | Temporal failure/retry metrics + custom application logs |

---

## 8. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Ontology layer between agents and reality | Palantir-inspired | Agents reason over typed objects, not raw DOM/API; decouples AI from UI changes; enables systematic guardrails |
| Actions as the only mutation path | Action Types with validation | Every change is validated, permissioned, cooldown-enforced, and audited before execution |
| Autonomy tiers (GREEN→RED) | Graduated trust | Start supervised, earn autonomy; matches Palantir's "version control for reality" pattern |
| Act through UI for visibility | Browser executor | Humans see exactly what Sisyphus does in real time; builds trust |
| LangGraph over CrewAI | LangGraph | More precise control over state and routing; production-proven at scale |
| Temporal for durability | Temporal.io | 8-12 hour shifts need crash recovery; Temporal is purpose-built for this |
| Local LLM + cloud fallback | Hybrid | Cost-effective for routine tasks; cloud for complex reasoning |
| Process .md files | Markdown runbooks | Human-readable, version-controlled, easy to update business logic |
| Redis for temporal memory | Redis | Sub-millisecond cooldown checks; TTL-based auto-cleanup |

---

## Next Steps

See companion documents:
- `02-technology-stack.md` — Detailed technology choices and rationale
- `03-agent-design.md` — Agent hierarchy, process files, delegation model
- `04-memory-system.md` — Memory architecture and temporal awareness
- `05-infrastructure.md` — Docker, hardware, deployment
- `06-cost-analysis.md` — Cost projections and ROI
- `07-implementation-roadmap.md` — Phased rollout plan
- `08-palantir-ontology-research.md` — Deep research on Palantir's architecture
- `09-ontology-layer-design.md` — Object types, action types, guardrails, execution layer
