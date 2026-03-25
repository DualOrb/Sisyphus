# Sisyphus: Implementation Roadmap

**Date:** 2026-03-25
**Status:** Planning

---

## Overview

Four phases, each delivering usable value before moving to the next. Sisyphus should never be "done" — it gets progressively more capable.

```
Phase 1          Phase 2          Phase 3          Phase 4
Foundation       Shadow Mode      Supervised       Autonomous
                                  Dispatch         Dispatch
─────────────►  ─────────────►  ─────────────►  ─────────────►
2-3 weeks        3-4 weeks        4-6 weeks        Ongoing

Cloud LLMs       Cloud LLMs       Buy Halo HW      Local + Cloud
Dev machine      Dev machine      Docker on server  Production
Basic loop       Full agents      Real dispatch     Full operation
```

---

## Phase 1: Foundation (Weeks 1-3)

**Goal**: Build the ontology layer and prove that Sisyphus can model the dispatch world, validate actions, and execute one through the browser.

**Infrastructure**: Developer machine, OpenRouter (free/cheap models), Docker Compose (local)

### Deliverables

| # | Deliverable | Description |
|---|------------|-------------|
| 1.1 | **Project scaffold** | Python project, Docker Compose with Redis + Postgres + Chrome |
| 1.2 | **LLM interface** | Unified client that works with OpenRouter and local llama.cpp |
| 1.3 | **Ontology object models** | Pydantic models for Order, Driver, Customer, Restaurant, Ticket, Zone, Conversation, Message |
| 1.4 | **Ontology sync layer** | Polls dispatch REST API every 30s, populates object models into Redis/state |
| 1.5 | **Action type registry** | Framework for defining actions with submission criteria, cooldowns, tiers |
| 1.6 | **Core action types** | Define 5-6 initial actions: AssignDriver, SendMessage, UpdateStatus, AddNote, Escalate |
| 1.7 | **Guardrails engine** | Submission criteria validator, cooldown enforcer, rate limiter, audit logger |
| 1.8 | **Browser executor** | Playwright connects to Chrome; translates 2-3 action types into UI workflows |
| 1.9 | **Authentication** | Sisyphus logs into dispatch via Cognito (browser-based) |
| 1.10 | **Process file loader** | Reads and parses process .md files with YAML frontmatter |
| 1.11 | **End-to-end proof** | Agent queries ontology → decides on action → ontology validates → browser executes |

### Success Criteria

- [ ] Ontology objects populated from dispatch API (orders, drivers, zones visible as typed objects)
- [ ] Action type registry validates submission criteria correctly (blocks invalid actions)
- [ ] Cooldown system prevents double-actions at the ontology layer
- [ ] Sisyphus authenticates and appears in the dispatch presence list
- [ ] Can execute one action through the full pipeline: ontology → browser → dispatch UI
- [ ] Audit record written to PostgreSQL with action params, reasoning, and outcome
- [ ] Process files are loaded and accessible to the agent

### Technical Decisions to Make

- Finalize Chrome container choice (Steel vs. Browserless vs. plain Chrome)
- Decide on browser-use vs. pure Playwright for the execution layer
- Establish project structure and coding patterns
- Decide which object properties are synced vs. computed

---

## Phase 2: Shadow Mode (Weeks 4-7)

**Goal**: Build all sub-agents. Run alongside a human dispatcher — Sisyphus observes and recommends but doesn't act autonomously.

**Infrastructure**: Same as Phase 1, but with better models on OpenRouter.

### Deliverables

| # | Deliverable | Description |
|---|------------|-------------|
| 2.1 | **LangGraph supervisor** | Full supervisor agent with ontology tools and delegation logic |
| 2.2 | **Market Monitor agent** | Queries Zone/Order/Driver objects, computes health, calls FlagMarketIssue |
| 2.3 | **Driver Comms agent** | Queries Conversation/Message objects, calls SendDriverMessage/FollowUp (shadow: logs proposals only) |
| 2.4 | **Customer Support agent** | Queries Ticket objects with linked Orders, calls ResolveTicket/Escalate (shadow: logs proposals only) |
| 2.5 | **Task Executor agent** | Can perform admin actions on command |
| 2.6 | **Full action type library** | All ~20 action types defined with submission criteria, tiers, cooldowns |
| 2.7 | **Temporal integration** | Shift lifecycle management, crash recovery |
| 2.8 | **Full memory system** | Redis operational memory + PostgreSQL persistence + ontology sync |
| 2.9 | **Shadow mode** | Actions proposed but not executed; logged with reasoning for human review |
| 2.10 | **Process files v1** | First batch of process .md files for all common scenarios |
| 2.11 | **Context sharing** | Task context objects, entity locks via ontology, agent coordination |

### Shadow Mode Operation

```
Human dispatcher works normally
        │
        ▼
Sisyphus runs in parallel:
  ├── Monitors same markets
  ├── Sees same messages and tickets
  ├── Decides what it WOULD do
  ├── Logs its proposed actions
  └── Human reviews proposals after their shift

Comparison metrics:
  - Did Sisyphus propose the same action the human took?
  - Would Sisyphus have been faster?
  - Did Sisyphus catch something the human missed?
  - Did Sisyphus propose anything wrong/harmful?
```

### Success Criteria

- [ ] All 4 sub-agents functional and delegating correctly
- [ ] Shadow mode produces proposals for 80%+ of dispatch events
- [ ] Proposal accuracy: 85%+ match with human dispatcher actions
- [ ] Temporal manages shift lifecycle (start, run, stop, recover)
- [ ] Full memory system operational (cooldowns, context, persistence)
- [ ] Can run a full 8-hour shadow shift without crashing

---

## Phase 3: Supervised Dispatch (Weeks 8-13)

**Goal**: Sisyphus takes real actions, but a human supervisor monitors and can override.

**Infrastructure**: Buy AMD Halo hardware. Deploy Docker stack on dedicated server.

### Deliverables

| # | Deliverable | Description |
|---|------------|-------------|
| 3.1 | **AMD Halo setup** | Fedora + llama.cpp + Qwen3-30B-A3B running |
| 3.2 | **Server Docker deployment** | Full stack on server machine |
| 3.3 | **Autonomy tier activation** | GREEN/YELLOW actions auto-execute; ORANGE staged for review; RED always human-approved |
| 3.4 | **Proposal/approval system** | ORANGE/RED actions staged as proposals; human reviews reasoning + before/after state |
| 3.5 | **Escalation flow** | Sisyphus escalates to human when uncertain |
| 3.6 | **Process files v2** | Refined based on shadow mode learnings |
| 3.7 | **Error recovery** | Graceful handling of browser errors, LLM failures, API issues |
| 3.8 | **Monitoring dashboard** | Health checks, action logs, error rates |
| 3.9 | **Shift handoff** | Beginning/end of shift summaries and handoff notes |

### Autonomy Tiers (Enforced by Ontology Layer)

Not all actions are equal. Tiers are defined per action type in the ontology and enforced automatically:

| Tier | Actions | Behavior |
|------|---------|----------|
| **GREEN** (safe) | Query objects, add notes, escalate, flag issues, forward status transitions | Auto-execute, quiet logging |
| **YELLOW** (moderate) | Send driver messages, assign drivers, update order status, standard ticket resolutions | Auto-execute, logged prominently, visible to human dispatchers |
| **ORANGE** (significant) | Refunds < $25, reassign orders, close tickets, batch operations | Staged as proposal during ramp-up → graduates to YELLOW as trust builds |
| **RED** (high-impact) | Refunds >= $25, cancel orders, driver deactivation, system-wide changes | Always staged for human approval |

The ontology layer enforces this — agents don't need to know their tier. They just call `execute_action()` and the system handles routing (auto-execute vs. stage for review).

Over time, as confidence grows, ORANGE actions graduate to YELLOW. RED stays RED.

### Success Criteria

- [ ] Local inference running on Halo at 40+ tok/s
- [ ] Sisyphus handles 70%+ of routine dispatch tasks autonomously
- [ ] Human override works correctly (Sisyphus backs off)
- [ ] No major errors (wrong refund, wrong assignment) in first 2 weeks
- [ ] Shift handoff produces useful summaries
- [ ] Docker stack runs stable for 7+ days without intervention

---

## Phase 4: Autonomous Dispatch (Week 14+, Ongoing)

**Goal**: Sisyphus operates as a primary dispatcher. Humans supervise and handle edge cases.

### Deliverables

| # | Deliverable | Description |
|---|------------|-------------|
| 4.1 | **Full autonomy** | Most action tiers auto-execute |
| 4.2 | **Multi-market support** | Handle all ValleyEats markets simultaneously |
| 4.3 | **Learning from corrections** | When human overrides Sisyphus, capture the correction for process improvement |
| 4.4 | **Process file refinement** | Continuous improvement based on real-world performance |
| 4.5 | **Performance analytics** | Compare Sisyphus metrics to historical human dispatcher metrics |
| 4.6 | **Extended hours** (optional) | Expand to cover late-night orders where no human dispatcher is available |

### Ongoing Metrics

| Metric | Target |
|--------|--------|
| Actions per shift | Track and trend upward |
| Accuracy (correct decisions) | > 95% |
| Escalation rate | < 10% of events |
| Average response time (driver messages) | < 30 seconds |
| Customer satisfaction (post-resolution) | >= human baseline |
| Shift uptime | > 99% |
| Cost per action | Track and trend downward |

---

## Phase Dependency Map

```
Phase 1                        Phase 2                     Phase 3                Phase 4
────────                       ────────                    ────────               ────────

1.1  Project scaffold ────────► 2.1  LangGraph supervisor
1.2  LLM interface ──────────► 2.2  Market Monitor ──────► 3.1  Halo setup
1.3  Ontology object models ─► 2.3  Driver Comms ────────► 3.3  Autonomy tiers
1.4  Ontology sync layer ───► 2.4  Customer Support ────► 3.4  Proposal system
1.5  Action type registry ──► 2.5  Task Executor              │
1.6  Core action types ─────► 2.6  Full action library ──► 3.7  Error recovery ─► 4.1 Full autonomy
1.7  Guardrails engine ─────► 2.7  Temporal ─────────────► 3.2  Server deploy
1.8  Browser executor ──────► 2.8  Full memory system ───► 3.8  Monitoring ──────► 4.5 Analytics
1.9  Authentication ────────► 2.9  Shadow mode ──────────► 3.9  Shift handoff ──► 4.3 Learning
1.10 Process file loader ───► 2.10 Process files v1 ────► 3.6  Process files v2 ► 4.4 Refinement
1.11 End-to-end proof        2.11 Context sharing ─────► 3.5  Escalation flow ─► 4.2 Multi-market
                                                           4.6 Scenario sandbox
```

---

## Key Milestones

| Milestone | When | Validation |
|-----------|------|-----------|
| "It can model" | End of Week 1 | Ontology objects populated from dispatch API; typed objects queryable |
| "It can validate" | End of Week 2 | Action types with submission criteria block invalid actions; audit trail works |
| "It can act" | End of Week 3 | Full pipeline: ontology → guardrails → browser executor → dispatch UI |
| "It can think" | End of Week 5 | Full agent hierarchy querying ontology and calling actions |
| "It can shadow" | End of Week 7 | Full shadow shift: agents propose actions, logged with reasoning |
| "It can dispatch" | End of Week 10 | First supervised live shift with GREEN/YELLOW auto-executing |
| "It can run alone" | End of Week 13 | First unsupervised shift; ORANGE actions graduating |
| "It's reliable" | Week 16+ | 2+ weeks of stable autonomous operation |

---

## Risk Mitigation Per Phase

### Phase 1 Risks
- **Ontology model mismatch**: Object models might not match dispatch API shapes perfectly — iterate quickly
- **Chrome container instability**: Test multiple container options early
- **Cognito auth issues**: Ensure service account setup is correct
- **Over-engineering the ontology**: Keep it simple — 6-8 object types, ~20 actions. Don't build Palantir

### Phase 2 Risks
- **Agent quality**: Shadow mode is explicitly for catching bad decisions safely
- **Scope creep**: Resist adding features; focus on core dispatch loop

### Phase 3 Risks
- **Halo driver issues**: Budget 2-3 days for Linux/driver setup and debugging
- **First real mistakes**: Have human dispatcher ready to intervene; start with Green-tier actions only

### Phase 4 Risks
- **Complacency**: Human supervisors must stay engaged, not assume Sisyphus is always right
- **Process drift**: Regularly review and update process .md files based on real incidents

---

## Team & Resources Required

| Role | Phase 1-2 | Phase 3-4 |
|------|-----------|-----------|
| **Developer** (Python, LangGraph, browser automation) | Full-time | Part-time (maintenance) |
| **Dispatch subject matter expert** | 2-4 hrs/week (writing process files, reviewing shadow output) | 1-2 hrs/week |
| **Human dispatcher** (for shadow comparison) | Existing staff | Existing staff (supervisor role) |
| **DevOps** (Docker, server setup) | 10-15 hours total | Occasional |

---

## What We're NOT Building (Scope Boundaries)

- **Not replacing the dispatch UI** — Sisyphus uses the existing one
- **Not building Palantir** — Our ontology is ~1,500 lines of Python, not an enterprise platform. 6-8 object types, ~20 actions. Keep it lean.
- **Not building custom ML models** — Using off-the-shelf LLMs
- **Not handling phone calls** — Phone stays with human dispatchers (Phase 4+ consideration)
- **Not modifying the dispatch backend** — Sisyphus acts through the UI/API as-is
- **Not building customer-facing chat** — Sisyphus operates internally, through dispatch
- **Not automating order assignment algorithm** — That's a separate system; Sisyphus handles exceptions
- **Not building a graph database** — Pydantic models + Redis cache is sufficient for our scale
