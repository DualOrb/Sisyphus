# Sisyphus — Progress Tracker

## Phase 1: Foundation

### Planning (Complete)
- [x] System architecture plan (01)
- [x] Technology stack decisions — TypeScript/Node.js (02)
- [x] Agent design & process framework (03)
- [x] Memory & context system design (04)
- [x] Infrastructure & hardware plan (05)
- [x] Cost analysis & business case (06)
- [x] Implementation roadmap (07)
- [x] Palantir ontology research (08)
- [x] Ontology layer design (09)
- [x] DynamoDB data model discovery — 34 tables explored (10)
- [x] Ontology ↔ data mapping (11)

### Scaffold (Complete)
- [x] Project structure (TypeScript ESM, Node 22)
- [x] package.json with all dependencies
- [x] tsconfig.json with path aliases
- [x] Docker (Dockerfile + docker-compose with Temporal, Chrome, Redis, PostgreSQL)
- [x] .env.example with all configuration
- [x] Vitest config
- [x] .gitignore

### Config & Utilities (Complete)
- [x] Zod-validated environment config (src/config/env.ts)
- [x] Pino logger with pretty-print dev mode (src/lib/logger.ts)

### Ontology Layer (Complete)
- [x] 11 enums grounded in real DynamoDB values (OrderStatus, IssueStatus, etc.)
- [x] Shared types: GeoPoint, MoneyInCents (branded), MinutesFromMidnight (branded)
- [x] 9 Zod schemas: Order, Driver, Restaurant, Customer, Ticket, Market, Conversation, Message + OrderItem
- [x] Computed properties: isLate, isOnline, isOpen, isTabletOnline, driverGap, etc.
- [x] OntologyStore — in-memory Maps with typed queries (queryOrders, queryDrivers, queryTickets)
- [x] DispatchApiClient — wraps all 8 dispatch REST endpoints
- [x] 6 entity transformers (DynamoDB field names → ontology camelCase)
- [x] OntologySyncer — parallel fetch → transform → store update, 30s polling, cross-entity enrichment
- [x] 11 action type definitions: AssignDriverToOrder, ReassignOrder, UpdateOrderStatus, CancelOrder, SendDriverMessage, FollowUpWithDriver, ResolveTicket, EscalateTicket, AddTicketNote, UpdateTicketOwner, FlagMarketIssue
- [x] Each action has Zod param schemas, submission criteria, cooldowns, rate limits, autonomy tiers

### Guardrails Engine (Complete)
- [x] Action registry (defineAction/getAction/listActions)
- [x] Submission criteria validator
- [x] Redis-backed cooldown enforcement
- [x] Sliding-window rate limiter
- [x] Circuit breaker (>3 failures/5min = paused, >5/15min = human alert)
- [x] executeAction() — 11-stage pipeline: Zod validate → cooldown → rate limit → circuit breaker → criteria → tier check → execute → set cooldown → audit → return
- [x] Full AuditRecord type (15 fields including reasoning, before/after state)

### Memory Layer (Complete)
- [x] Redis client factory (ioredis with auto-reconnect)
- [x] Action timeline (sorted sets scored by timestamp, 24h TTL)
- [x] Entity locks (atomic acquire/release with Lua script)
- [x] Agent heartbeats (120s TTL)
- [x] Generic cache helpers (JSON get/set/delete)
- [x] Drizzle ORM schema: auditLog (18 cols, 4 indexes), shiftSummary, entityInteractions
- [x] PostgreSQL query helpers: getEntityHistory, getShiftHandoff, writeAuditRecord, writeShiftSummary

### LLM Client (Complete)
- [x] Unified OpenAI-compatible client (works with llama.cpp + OpenRouter)
- [x] Automatic fallback: local → cloud on connection error/timeout
- [x] Model routing: monitoring/messaging → local, complex reasoning → cloud
- [x] Token usage tracker with cost estimation

### Execution Layer (Complete)
- [x] BrowserExecutor — Playwright scripts for 5 actions (assign, message, status, reassign, resolve)
- [x] CDP connection management + Cognito auth flow
- [x] ApiExecutor — REST calls for 5 background actions (note, status, owner, read, flag)
- [x] DispatchApiWriter — 7 write endpoints with auth + Sisyphus context headers
- [x] ExecutionRouter — routes action names to browser/API/internal executors

### Agent Tools (Complete)
- [x] Process .md file loader with YAML frontmatter parsing
- [x] System prompt builder (global rules + agent-specific processes)
- [x] 7 LangGraph DynamicStructuredTools: queryOrders, queryDrivers, queryTickets, getOrderDetails, getEntityTimeline, executeAction, requestClarification

### LangGraph Agents (Complete)
- [x] AgentState (Annotation-based with messages, routing, escalation)
- [x] ChatOpenAI factory with task-type model routing
- [x] createAgentNode() — react-style tool loop (LLM → tool → repeat)
- [x] Supervisor agent — routes to sub-agents via route_to_agent tool pattern
- [x] Market Monitor agent — filtered tools for health monitoring
- [x] Driver Comms agent — filtered tools for driver messaging
- [x] Customer Support agent — filtered tools for ticket resolution
- [x] Task Executor agent — shared utility callable by any agent
- [x] createDispatchGraph() — full StateGraph with conditional routing

### Temporal Shift Workflow (Complete)
- [x] 8 activities (startBrowser, auth, syncOntology, runDispatchCycle, writeShiftSummary, disconnect, isWithinBusinessHours, getShiftStats)
- [x] sisyphusShiftWorkflow — startup → auth → main loop → graceful shutdown → continueAsNew
- [x] Worker setup with activity registration
- [x] Daily schedule creator (idempotent)
- [x] Main entry point (src/index.ts) with boot sequence + graceful shutdown

### Process Runbooks (Complete — 13 files)
- [x] AGENTS.md — master system prompt with 10 global rules
- [x] supervisor/triage-priority.md
- [x] supervisor/escalation-criteria.md
- [x] supervisor/shift-start.md
- [x] supervisor/shift-end.md
- [x] market-monitor/market-health.md (score thresholds aligned to real MarketMeters data)
- [x] market-monitor/surge-handling.md
- [x] driver-comms/driver-messaging.md
- [x] driver-comms/assignment-followup.md
- [x] driver-comms/no-response-protocol.md
- [x] customer-support/ticket-resolution.md
- [x] customer-support/refund-policy.md (cents, $25 threshold for autonomy tiers)
- [x] task-executor/restaurant-updates.md

---

### Wiring & Tests (Complete)
- [x] TypeScript type-check passes clean (0 errors, 112 files)
- [x] Temporal activity stubs wired to real modules (browser, syncer, graph, postgres)
- [x] 155 tests passing (432ms):
  - Guardrails: 31 tests (registry, validator, cooldown, rate limiter, circuit breaker)
  - Ontology: 70 tests (transformers, store queries, schema validation)
  - Memory: 29 tests (action timeline, locks, heartbeat)
  - Integration: 25 tests (full pipeline: fake data → ontology tools → guardrails → action execution → audit trail → cooldowns → circuit breaker)

## Phase 1: Complete
All Phase 1 deliverables done. System is architecturally complete and tested in isolation.
Live dispatch integration (API sync, Playwright selectors) deferred until dispatch-new is stable.

## Phase 2: Shadow Mode

### Shadow Executor & Proposal System (Complete)
- [x] `ShadowExecutor` — replaces real browser/API execution, logs proposals instead
- [x] `ProposalStore` — PostgreSQL persistence for proposals with Drizzle schema (`shadow_proposals` table)
- [x] `ShadowMetrics` — per-shift tracking: total proposals, by action/tier/agent/validation, accuracy reports
- [x] Operating mode system (`OPERATING_MODE` env: shadow/supervised/autonomous)
- [x] ExecutionRouter shadow interception — all actions route through shadow executor when in shadow mode
- [x] `markReviewed()` — human can agree/disagree with proposals for accuracy tracking
- [x] 21 shadow mode unit tests passing

### Simulation Harness (Complete)
- [x] 5 dispatch scenarios (27 actions total, all passing):
  - Unassigned Orders Piling Up (6 actions) — resource scarcity, cooldowns, paused/offline driver rejection
  - Driver Unresponsive Mid-Delivery (5 actions) — follow-up protocol, cooldown, reassignment
  - Ticket Flood (6 actions) — triage prioritization, tier routing (GREEN auto, ORANGE/RED staged)
  - Market Surge (5 actions) — health detection, flagging, cross-zone awareness
  - Happy Path (5 actions) — routine operations, guardrails reject invalid actions
- [x] Runnable via `tsx scripts/simulate.ts` with --verbose and --only flags

### Remaining Phase 2 Work
- [ ] Process file refinement based on simulation/shadow results
- [ ] Shadow shift report generator (formatted HTML/markdown summary of proposals)

## Phase 3: Supervised Dispatch (Not Started)
- [ ] AMD Halo hardware setup
- [ ] Autonomy tier activation (GREEN/YELLOW auto-execute)
- [ ] Proposal/approval system for ORANGE/RED actions
- [ ] Server Docker deployment

## Phase 4: Autonomous Dispatch (Not Started)
- [ ] Full autonomy with human supervision
- [ ] Learning from corrections
- [ ] Multi-market support
- [ ] Extended hours coverage
