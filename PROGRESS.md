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
- [x] ~~Market Monitor agent~~ — **removed; market health monitoring consolidated into Supervisor agent**
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

### Shift Report Generator (Complete)
- [x] `generateShiftReport()` — assembles report from shift stats, proposals, metrics, audit records, token usage
- [x] Markdown formatter — professional report with tables, collapsible details, recommendations
- [x] JSON formatter — for programmatic consumption
- [x] Sample report generator script (`tsx scripts/generate-report.ts`)
- [x] Auto-generated recommendations (low driver coverage, high error rates, escalation patterns)

### WebSocket Integration (Complete)
- [x] `DispatchWebSocket` — connects to dispatch WS, auto-reconnect with exponential backoff, 60s keepalive ping
- [x] `SisyphusPresence` — broadcasts what Sisyphus is doing (route, viewMode, activity) to other dispatchers
- [x] `MessageListener` — queues incoming driver messages (bounded queue, max 100) for agent processing
- [x] 21 WebSocket unit tests passing

### DynaClone MySQL Client (Complete)
- [x] `DynaCloneClient` — MySQL connection pool (max 5), credentials from Secrets Manager or config
- [x] 5 pre-built dispatch queries (active drivers on shift, on-call availability, predicted driver count, order subtotal, delivery stats)
- [x] Data utilities: `fixDynacloneArrays`, `parseIntField`, `parseBoolField`, `epochToDate`
- [x] 40 DynaClone utility tests passing

### Additional Process Files (Complete — 20 total)
- [x] customer-support/late-delivery.md — cause identification, refund by delay severity
- [x] customer-support/missing-items.md — item-level investigation and partial refund
- [x] customer-support/wrong-order.md — always full refund, restaurant flagging
- [x] market-monitor/staffing-alerts.md — driver gap detection, shift forecasting
- [x] driver-comms/driver-issues.md — app problems, navigation, restaurant closed, customer unreachable
- [x] task-executor/menu-management.md — toggle availability, price updates, bulk ops
- [x] task-executor/admin-tasks.md — zone updates, market settings, data corrections

### Additional Scenarios (Complete — 7 total, 40 actions)
- [x] Late Delivery Chain (6 actions) — investigate → document → escalate → resolve → message driver → cooldown
- [x] Shift Transition (7 actions) — handoff notes, flag unassigned orders, market health, shift summary

### Event Processing Pipeline (Complete)
- [x] `EventDetector` — scans ontology for actionable situations (unassigned orders, market alerts, driver offline, new tickets, status changes)
- [x] `EventQueue` — priority queue (critical > high > normal > low), bounded at 500 events, FIFO within priority
- [x] `EventDispatcher` — formats events into natural language for the supervisor agent
- [x] `DispatchCycle` — full cycle: collect messages → detect events → queue → format → invoke graph
- [x] 32 event system tests passing

### Health & Monitoring (Complete)
- [x] Health checks for Redis, PostgreSQL, OntologyStore, LLM, Chrome, Temporal worker
- [x] HTTP health endpoint (GET /health, /health/ready, /health/live, /status)
- [x] Docker HEALTHCHECK directive added to Dockerfile
- [x] `aggregateHealth()` — critical component failure = unhealthy, non-critical = degraded
- [x] 19 health check tests passing

### Developer CLI Tools (Complete)
- [x] `tsx scripts/inspect-store.ts` — inspect ontology state with fake data (--orders, --drivers, --markets flags)
- [x] `tsx scripts/inspect-actions.ts` — formatted table of all 11 registered actions with tiers, cooldowns, criteria
- [x] `tsx scripts/test-action.ts <ActionName> '{params}'` — test single action through full guardrails pipeline
- [x] `tsx scripts/validate-processes.ts` — validate all 20 process files (frontmatter, agent names, priorities)
- [x] `ProcessWatcher` — hot-reload process .md files on change with 500ms debounce
- [x] 9 process watcher tests passing

### Test Summary
- 297 unit/integration tests passing (477ms)
- 7 simulation scenarios, 40 actions, all passing
- 20 process files validated
- 5 CLI tools working

### Dispatch Adapter Layer (Complete)
- [x] `DispatchAdapter` interface — unified API for both old and new dispatch systems
- [x] `OldDispatchClient` — calls `/post/*.php` endpoints with session cookie (form-encoded POST)
- [x] `NewDispatchClient` — wraps existing DispatchApiClient/Writer for new dispatch
- [x] Old dispatch auth — Cognito redirect flow via Playwright + session cookie extraction
- [x] Adapter factory — `DISPATCH_ADAPTER` env var selects old-dispatch (default) or new-dispatch
- [x] `OntologySyncSource` interface — syncer works with either adapter without breaking changes
- [x] Old dispatch response transformers:
  - DynamoDB wire format unwrapper ({S:}, {N:}, {BOOL:} → plain values)
  - PHP value normalizer ("true"/"false"/"null" strings)
  - `parseDispatchCache` — splits builddispatchcache.php blob into typed arrays
  - `parseIssueRows` — extracts structured data from HTML via data-* attributes
  - `parseOrderDetails`/`parseDriverDetails` — unwrap DynamoDB responses
- [x] Old dispatch discovery doc (planning/12-old-dispatch-discovery.md)
- [x] 91 adapter tests passing (31 client + 60 transformer)

### System Initialization (Complete)
- [x] `initializeConnections()` — boots Redis, PostgreSQL, dispatch adapter, Chrome, auth, session cookie
- [x] `initializeServices()` — creates OntologyStore, syncer, LangGraph graph, event pipeline, WebSocket, presence, DispatchCycle
- [x] `initializeSisyphus()` — single function that boots the entire system
- [x] `shutdownSisyphus()` — graceful teardown in reverse order (syncer, WS, browser, Redis, PG, health)
- [x] `createActivities()` factory — Temporal activities wired to live infrastructure (no lazy init)
- [x] Temporal worker uses init system, starts health server, registers activities
- [x] Main entry point (src/index.ts) simplified: worker start → schedule → shutdown handlers
- [x] Non-fatal Chrome/auth failures — system boots in degraded mode without browser

### AWS Integration (Complete)
- [x] AWS Secrets Manager client (`@aws-sdk/client-secrets-manager`)
- [x] `fetchDynaCloneCredentials()` — extracts DB creds from Secrets Manager (matches VendorPortal field names)
- [x] `createDynaCloneFromSecrets()` — factory that creates DynaClone client from Secrets Manager
- [x] 5-minute credential cache (matching existing VendorPortal pattern)
- [x] 13 AWS secrets tests passing

### Test Summary
- 401 unit/integration tests passing (573ms)
- 7 simulation scenarios, 40 actions, all passing
- 20 process files validated
- 5 CLI tools working

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
