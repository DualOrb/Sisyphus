# Sisyphus — AI Dispatcher for ValleyEats

Autonomous multi-agent dispatch system that monitors delivery operations and takes action on late orders, unassigned deliveries, driver issues, and support tickets.

## Stack

- **Runtime**: TypeScript, Node.js (ESM)
- **Agent framework**: LangGraph.js (StateGraph with parallel dispatch via Send)
- **LLM**: OpenAI-compatible API (Groq, OpenRouter) — model configured via `LLM_MODEL` env
- **State**: Redis (cooldowns, locks, timelines, heartbeats), PostgreSQL (audit trail, shift reports)
- **Ontology**: Zod schemas, in-memory OntologyStore synced from S3 dispatch.txt + DynamoDB
- **Tracing**: Langfuse (self-hosted, Docker)
- **Orchestration**: Temporal (shift workflows, activities)
- **Browser automation**: Playwright (dispatch portal interaction)

## Architecture

```
Supervisor (router) ─┬─ driver_comms (messages, assignments, reassignments)
                     ├─ customer_support (ticket resolution)
                     └─ task_executor (admin actions, market flagging)
```

Each cycle: sync dispatch data → detect changes → build prompt → invoke graph → record actions to ledger.

The supervisor is the MONITOR — it reads the dispatch board and routes specific actions to sub-agents. Sub-agents never "monitor" or "check on" things.

## Key Directories

- `src/agents/` — Agent definitions. Each agent has `agent.ts` (identity, tool filter) and `role.md` (prompt loaded at startup)
- `src/agents/supervisor/routing-rules.md` — Supervisor behavioral rules (loaded at startup, not hardcoded)
- `src/agents/task-directive.md` — Shared instructions injected into every sub-agent task
- `src/events/` — Dispatch cycle, change detection, action ledger
- `src/ontology/` — Zod schemas (objects/), action definitions (actions/), state store, sync layer
- `src/guardrails/` — Action execution pipeline: registry, validation, cooldowns, rate limits, circuit breaker
- `src/tools/` — Ontology tools (query_*, get_*, execute_action) and process retrieval (lookup_process with RAG)
- `src/execution/` — Shadow executor, browser executor, API executor, WebSocket client
- `processes/` — Markdown procedure files with YAML frontmatter (agent, trigger, priority). Loaded by process-loader.ts
- `scripts/` — shadow-live.ts (main shadow testing entry), validate-processes.ts, generate-report.ts

## Commands

```bash
npx tsc --noEmit          # Type check
npm test                  # Run tests (Vitest)
npx tsx scripts/shadow-live.ts  # Run shadow-live against production data
npx tsx scripts/validate-processes.ts  # Validate process .md files
```

## Conventions

- **Prompts live in markdown files** next to the agent that uses them (`role.md`, `routing-rules.md`, `task-directive.md`). Never hardcode prompt strings in TypeScript.
- **Process files** (`processes/*.md`) are for step-by-step procedures, not agent identity/behavior. Agent behavior goes in `src/agents/<name>/role.md`.
- **Takeout orders** are filtered out of the dispatch prompt and blocked from driver assignment at the guardrails level.
- **Late threshold** is 5 minutes past ready time. Orders are not flagged LATE until then.
- **Agent names**: Code uses underscores (`driver_comms`), process YAML uses hyphens (`driver-comms`). Two conventions, two domains.
- **Financial thresholds**: Single refund >= $25 = RED tier (human approval). Total impact > $50 = supervisor escalation.
- **No Python**. Everything is TypeScript/Node.js.
- **No live integration yet**. Build and test in isolation with shadow mode.

## Shadow-Live Testing

`shadow-live.ts` connects to real S3 dispatch data and DynamoDB tickets but executes actions through the ShadowExecutor (records proposals, no side effects). Redis is flushed on startup for clean state. Reports written to `reports/`.

Langfuse traces at `http://localhost:3100` — check the supervisor's input to see the full assembled prompt including RECENT ACTIONS ledger.

## Action Ledger

The `ActionLedger` (src/events/action-ledger.ts) accumulates a rolling 30-minute history of all AI actions across cycles. Rendered into the supervisor prompt as `-- RECENT ACTIONS --` with temporal markers and follow-up timers. Prevents re-dispatching work already in progress.

## Guardrails

Every `execute_action` goes through: schema validation → cooldown check → rate limit → circuit breaker → submission criteria → tier check (GREEN/YELLOW auto, ORANGE staged, RED human-only) → execute → set cooldown → audit log.

Cooldown responses include guidance text telling agents not to retry. Entity locks prevent parallel agents from acting on the same entity.
