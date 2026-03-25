# Sisyphus: Technology Stack Decisions

**Date:** 2026-03-25
**Status:** Planning

---

## 1. Stack Overview

| Layer | Technology | Role |
|-------|-----------|------|
| **Language** | TypeScript 5.x + Node.js 22 LTS | Primary application language (matches existing ValleyEats stack) |
| **Agent Orchestration** | LangGraph.js | Multi-agent supervisor/sub-agent graph |
| **Ontology Layer** | Zod schemas + custom Action registry | Typed objects, validated actions, guardrails, audit |
| **Durable Execution** | Temporal.io (TypeScript SDK) | Shift lifecycle, crash recovery, scheduling |
| **Browser Execution** | Playwright (native TypeScript) | Translates ontology actions into UI interactions |
| **Headless Browser** | Steel (self-hosted) or Browserless | Chrome container with CDP access |
| **Short-term Memory** | Redis 7+ (ioredis) | Cooldowns, action timestamps, locks, caching |
| **Long-term Memory** | PostgreSQL 16 (Drizzle ORM) | Audit trail, LangGraph checkpoints, persistent state |
| **Local LLM Inference** | llama.cpp (Vulkan backend) | Primary inference on AMD Halo hardware |
| **Cloud LLM Fallback** | OpenRouter API | Complex reasoning tasks, testing, fallback |
| **Containerization** | Docker + Docker Compose | All services containerized |

---

## 2. Why TypeScript

| Factor | TypeScript | Python | Go |
|--------|-----------|--------|-----|
| **LangGraph support** | LangGraph.js (official) | LangGraph (original) | Nothing |
| **Temporal SDK** | First-class | First-class | First-class (best) |
| **Playwright** | **Native, first-class** | Works, not native | Community fork |
| **LLM clients** | Official OpenAI SDK | Official OpenAI SDK | Minimal |
| **Type safety** | Strong (strict + Zod) | Weak (Pydantic helps) | Strongest |
| **Existing team stack** | **Already using it** | Separate ecosystem | New language |
| **Share types with dispatch** | **Same language** | No | No |

TypeScript wins because it covers every library we need, matches the existing ValleyEats codebase (React + Node.js), and lets us share type definitions with the dispatch frontend.

---

## 3. Agent Orchestration: LangGraph.js

### Why LangGraph over alternatives

| Framework | Pros | Cons | Verdict |
|-----------|------|------|---------|
| **LangGraph.js** | Graph-based state machine, supervisor pattern, production-proven, checkpointing, LangSmith observability, TypeScript-native | Newer than Python version | **Selected** |
| **Mastra** | TypeScript-native agent framework | Less mature, smaller community | Worth watching |
| **Custom** | Full control | Massive effort reinventing solved problems | Not practical |

### Key LangGraph.js Features We'll Use

- **`createSupervisor`**: First-class API for dispatcher-delegates-to-sub-agents pattern
- **Annotation-based state**: All agents read/write to centralized typed state — natural shared context
- **Checkpointing**: Persist state to PostgreSQL; resume from failure
- **Human-in-the-loop**: Built-in interrupt points where a human dispatcher can override
- **Streaming**: Stream agent actions for real-time observability

### LangGraph + Ontology + Temporal Integration

Three layers with distinct responsibilities:

- **LangGraph.js** handles *agent logic* (what to decide, who to delegate to)
- **Ontology** handles *world modeling and action validation* (what exists, what's allowed, what happened)
- **Temporal** handles *operational lifecycle* (when to start, how to recover, how to run 8-12 hours)

```
Temporal Workflow (shift lifecycle)
  └── LangGraph Graph (agent decisions)
       ├── Supervisor Node
       ├── Market Monitor Node      ─── queries ──→  Ontology Objects
       ├── Driver Comms Node        ─── calls ────→  Ontology Actions
       ├── Customer Support Node    ─── calls ────→  Ontology Actions
       └── Task Executor            ─── calls ────→  Ontology Actions
                                                          │
                                                          ▼
                                                   Execution Layer
                                                   (Browser / API)
```

Agents interact with the ontology through typed tools (query objects, execute actions, check timelines). They never construct API calls or browser commands directly.

---

## 4. Durable Execution: Temporal.io

### Why Temporal

An 8-12 hour daily operation needs guarantees that LangGraph alone doesn't provide:

- **Process crash recovery**: If the Node.js process dies, Temporal restarts from the last checkpoint
- **Container restart tolerance**: Docker containers can restart without losing workflow state
- **Scheduled execution**: Built-in Schedules feature starts/stops Sisyphus at business hours
- **Retry policies**: Configurable retry with exponential backoff for transient failures
- **Observability**: Built-in workflow history and debugging UI

### What Temporal Manages

| Concern | How Temporal Handles It |
|---------|------------------------|
| Start of shift | Schedule triggers `start_shift` workflow at configured time |
| End of shift | Schedule triggers graceful shutdown |
| Agent crash | Workflow resumes from last checkpoint |
| Chrome crash | Activity triggers browser restart + re-authentication |
| Stuck task | Heartbeat timeouts detect and restart hung operations |
| Daily state | Workflow-level variables persist across the full shift |

### Temporal Deployment

- Self-hosted via Docker (Temporal Server + Temporal Worker)
- PostgreSQL as Temporal's persistence backend (shared with LangGraph)
- Temporal Web UI for monitoring workflow health
- TypeScript SDK (`@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow`)

---

## 5. Browser Execution Layer: Playwright

> **Important distinction:** In the original design, agents reasoned about DOM state
> and decided what to click. With the ontology layer, agents reason over typed objects
> and call named actions. The browser layer is now purely an **executor** — it translates
> ontology actions into deterministic UI workflows. Agents never see or parse HTML.

### Architecture

```
Ontology Action (e.g., "AssignDriverToOrder")
    │
    ▼
Browser Executor (maps action types to Playwright scripts)
    │
    ├── AssignDriverToOrder → navigate to order, click assign, select driver, confirm
    ├── SendDriverMessage → open messages panel, select conversation, type, send
    ├── UpdateOrderStatus → navigate to order, change status dropdown, confirm
    │
    ▼
Playwright (TypeScript-native browser automation)
    │
    ▼
Chrome DevTools Protocol (CDP)
    │
    ▼
Headless Chrome (Steel container, port 9222)
    │
    ▼
Dispatch Web Interface (dispatch-new)
```

### Why Playwright (native, no browser-use)

With the ontology layer, we don't need AI DOM reasoning anymore. Each action type maps to a deterministic Playwright script. This is actually better than browser-use because:

- **Playwright is TypeScript-native** — first-class API, same language as the rest of the app
- **Deterministic** — same action always runs the same script (no LLM token cost per browser interaction)
- **Auto-waiting** — waits for elements to be ready (critical for SPAs like our React dispatch app)
- **Free** — no per-task cost (browser-use was ~$0.07 per 10-step task)
- **We control the UI** — the dispatch interface is our code, so selectors are stable and known
- **Connect to remote Chrome** — `chromium.connectOverCDP('ws://chrome:9222')`

### Why not Puppeteer

- JavaScript/Node.js only — our stack is Python
- Chrome-only, fewer features than Playwright
- Playwright has surpassed it in reliability and ecosystem

### Why Playwright underneath

- Cross-browser support (though we only need Chrome)
- Auto-waiting for elements (critical for SPAs like our React dispatch app)
- Python-native API
- Mature Docker support
- Can connect to remote Chrome via `chromium.connect_over_cdp()`

### Headless Chrome Container

**Steel** (recommended) or **Browserless**:
- Self-hosted Docker container running Chrome
- Exposes CDP on port 9222
- Separate from agent container — Chrome crashes don't kill the agent
- Health checks and automatic restart
- Session persistence across reconnects

### Docker Environment Variables for browser-use

```
IN_DOCKER=True
BROWSER_USE_CHROME_NO_SANDBOX=1
CHROME_CDP_URL=ws://chrome:9222
```

---

## 6. Ontology Layer: Zod + Custom Action Registry

> Inspired by Palantir's Foundry Ontology (see `08-palantir-ontology-research.md`).
> Full design in `09-ontology-layer-design.md`.

### Why a custom ontology layer (not an off-the-shelf graph DB)

Our domain is small enough (6-8 object types, ~20 action types) that we don't need Neo4j or a full semantic web stack. What we need is:

1. **Typed objects** with explicit relationships — Zod schemas + TypeScript interfaces give us this with runtime validation
2. **Named actions** with submission criteria — a custom Action registry
3. **Guardrails enforcement** — submission criteria, cooldowns, rate limits, autonomy tiers
4. **Audit trail** — every action logged with reasoning, before/after state
5. **Sync from dispatch API** — poll REST endpoints, populate objects

### Technology Choices

| Component | Technology | Why |
|-----------|-----------|-----|
| **Object models** | Zod schemas → TypeScript types | Runtime validation + compile-time types from one definition; `z.infer<>` eliminates duplication |
| **Action registry** | Custom TypeScript (builder pattern) | Define actions with params, criteria, rules, tiers — no framework overhead |
| **Object store** | Redis (hot cache) + PostgreSQL (persistent) | Objects synced from dispatch API every 30s into Redis; historical state in Postgres |
| **Guardrails engine** | Custom TypeScript | Checks submission criteria, cooldowns, rate limits, tiers before execution |
| **Execution routing** | Config-driven | Maps action types to Browser Executor or API Executor |
| **Audit logger** | PostgreSQL via Drizzle ORM (append-only `audit_log` table) | Immutable record of every action with full context |

### How It Fits Together

```typescript
// Object type definition (Zod → TypeScript)
const OrderSchema = z.object({
  orderId: z.string(),
  status: OrderStatusEnum,
  driverId: z.string().nullable(),
  customerId: z.string(),
  restaurantId: z.string(),
  placedAt: z.date(),
  eta: z.date().nullable(),
  // ... links resolved via ontology.getLinked()
});
type Order = z.infer<typeof OrderSchema>;

// Action type definition (builder pattern)
const reassignOrder = defineAction({
  name: "ReassignOrder",
  tier: Tier.YELLOW,
  cooldown: { entity: "order", action: "reassign", ttl: 600 },
  execution: "browser",
  params: z.object({
    orderId: z.string(),
    newDriverId: z.string(),
    reason: z.string(),
  }),
  criteria: [
    (params, state) => state.getOrder(params.orderId).status in ["Confirmed", "Ready", "EnRoute"],
    (params, state) => state.getDriver(params.newDriverId).isAvailable,
  ],
});
```

This is lightweight (~1,500 lines of framework code) but gives us the Palantir-style guarantees: agents call actions, actions are validated, everything is audited.

### Why Zod over alternatives

| Library | Pros | Cons |
|---------|------|------|
| **Zod** | Runtime + compile-time from one definition (`z.infer`), composable, ecosystem standard, works with LangChain.js | — |
| io-ts | Functional style, good validation | Steeper learning curve, smaller ecosystem |
| TypeBox | JSON Schema compatible, fast | Less ergonomic, less ecosystem |
| Class-validator | Decorator-based (like Pydantic) | Requires classes, more boilerplate |

---

## 7. Memory: Redis + PostgreSQL

### Redis (ioredis)

**Purpose**: Fast, temporal state that agents check constantly

| Use Case | Redis Pattern | TTL |
|----------|--------------|-----|
| Action cooldowns | `cooldown:{target_type}:{target_id}:{action}` → timestamp | 5-30 min |
| Active task locks | `lock:task:{task_id}` → agent_id | 10 min |
| Recent actions log | Sorted set `actions:{entity_id}` scored by timestamp | 24 hours |
| Agent heartbeats | `heartbeat:{agent_id}` → last_active | 2 min |
| Market state cache | `market:{zone_id}` → JSON snapshot | 60 sec |

**Client**: `ioredis` — the de facto Redis client for Node.js, supports clusters, pipelines, Lua scripting.

### PostgreSQL (Drizzle ORM)

**Purpose**: Long-term records and LangGraph/Temporal state

| Table | Content |
|-------|---------|
| `audit_log` | Every action Sisyphus takes, with timestamps, reasoning, before/after state |
| `shift_summary` | Daily shift reports: actions taken, issues resolved, escalations |
| `entity_interactions` | Per-entity interaction history for cross-shift awareness |
| `langgraph_checkpoints` | LangGraph.js state persistence |
| `temporal_*` | Temporal's own persistence tables |

**ORM**: Drizzle — TypeScript-first, type-safe queries from schema definitions, lightweight, SQL-like syntax. Matches the existing ValleyEats pattern better than Prisma (which requires a separate schema language).

---

## 7. LLM Inference: Hybrid Local + Cloud

### Primary: Local AMD Halo

- **Hardware**: AMD Ryzen AI MAX+ 395, 128 GB unified memory
- **Software**: llama.cpp with Vulkan backend (best token generation speed)
- **Model**: Qwen3-30B-A3B (MoE) — 52-72 tok/s, strong quality for dispatch tasks
- **Fallback model**: Llama 3.3 70B (Q4) — 3-5 tok/s, for tasks needing more capability
- **Served via**: llama.cpp HTTP server (OpenAI-compatible API)

### Fallback: OpenRouter

- **When**: Complex reasoning tasks, local server unavailable, testing phase
- **API**: OpenAI-compatible, single integration point
- **Models**: Claude Sonnet 4.6 ($3/$15 per M tokens), GPT-4.1 ($2/$8 per M tokens)
- **Routing**: Application-level fallback — try local first, route to OpenRouter on failure/timeout

### Unified API Interface

Both local llama.cpp and OpenRouter expose OpenAI-compatible APIs. The application code uses a single client with configurable base URL:

```
LOCAL:       http://halo:8080/v1/chat/completions
OPENROUTER:  https://openrouter.ai/api/v1/chat/completions
```

Switching is a config change, not a code change.

---

## 9. Containerization: Docker Compose

See `05-infrastructure.md` for the full Docker Compose architecture.

### Container Summary

| Container | Image | Purpose | Resource Limits |
|-----------|-------|---------|----------------|
| `sisyphus-app` | Custom Node.js 22 | LangGraph agents + Temporal worker (single process) | 4 GB RAM, 2 CPU |
| `temporal-server` | temporalio/server | Workflow orchestration | 2 GB RAM, 1 CPU |
| `chrome` | steel-dev/steel | Headless Chrome via CDP | 2 GB RAM, 2 CPU |
| `redis` | redis:7-alpine | Operational memory | 1 GB RAM |
| `postgres` | postgres:16-alpine | Persistent state | 2 GB RAM |

> **Simplified from original plan:** The Temporal worker runs in the same Node.js process
> as the LangGraph agents (single `sisyphus-app` container). Temporal's TypeScript SDK
> supports in-process workers, so a separate worker container is unnecessary at our scale.

---

## 10. Development & Testing Stack

| Tool | Purpose |
|------|---------|
| **OpenRouter** | LLM API during development (before Halo hardware) |
| **LangSmith** | LangGraph trace observability and debugging |
| **Temporal Web UI** | Workflow monitoring and debugging |
| **Docker Desktop** | Local development environment |
| **Vitest** | Unit and integration testing (fast, TypeScript-native) |
| **Playwright Test** | Browser automation testing against dispatch UI |
| **tsx** | TypeScript execution without build step (development) |
| **tsup** | Fast TypeScript bundler for production builds |

---

## 11. Key Dependencies

```json
{
  "dependencies": {
    "@langchain/core": "^0.3",
    "@langchain/langgraph": "^0.2",
    "@langchain/openai": "^0.4",
    "@temporalio/client": "^1.11",
    "@temporalio/worker": "^1.11",
    "@temporalio/workflow": "^1.11",
    "@temporalio/activity": "^1.11",
    "playwright": "^1.49",
    "ioredis": "^5.4",
    "drizzle-orm": "^0.38",
    "pg": "^8.13",
    "zod": "^3.24",
    "openai": "^4.77",
    "gray-matter": "^4.0",
    "structlog": "^0.2",
    "dotenv": "^16.4"
  },
  "devDependencies": {
    "typescript": "^5.7",
    "tsx": "^4.19",
    "tsup": "^8.3",
    "vitest": "^3.0",
    "@types/node": "^22",
    "@types/pg": "^8"
  }
}
```

```
# Infrastructure
docker / docker-compose
temporal-server
steel or browserless
redis 7+
postgresql 16+
node.js 22 LTS
```
