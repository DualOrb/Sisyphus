# Sisyphus: Memory & Context System

**Date:** 2026-03-25
**Status:** Planning

---

## 1. The Problem

A human dispatcher remembers: "I just messaged that driver 2 minutes ago — don't bug them again yet." They also remember: "This customer called about the same order 30 minutes ago — they're getting frustrated."

Sisyphus needs this same temporal awareness, plus the ability to share context when multiple agents work the same task, and to maintain institutional memory across shifts.

---

## 2. Memory Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    MEMORY LAYERS                              │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Layer 1: WORKING MEMORY (LangGraph State)           │   │
│  │  Scope: Current graph execution                       │   │
│  │  Lifetime: Single task / delegation cycle             │   │
│  │  Content: Current task context, agent messages,       │   │
│  │           in-progress decisions                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Layer 2: OPERATIONAL MEMORY (Redis)                  │   │
│  │  Scope: Current shift (8-12 hours)                    │   │
│  │  Lifetime: TTL-based (minutes to hours)               │   │
│  │  Content: Cooldowns, recent actions, entity locks,    │   │
│  │           market state cache, agent heartbeats        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Layer 3: PERSISTENT MEMORY (PostgreSQL)              │   │
│  │  Scope: All time                                      │   │
│  │  Lifetime: Permanent (with retention policies)        │   │
│  │  Content: Action history, shift summaries,            │   │
│  │           entity interaction history,                 │   │
│  │           LangGraph checkpoints                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Layer 1: Working Memory (LangGraph State)

### What It Holds

The LangGraph state object is the "short-term memory" during active task processing. All agents in the graph can read and write to it.

```typescript
// LangGraph.js state definition (Annotation-based)
interface SisyphusState {
  // === Ontology (the structured world model) ===
  ontology: OntologyState;              // All synced objects — agents query this, never raw APIs
                                        // Populated from dispatch API every 30s
                                        // Contains: Orders, Drivers, Customers, Restaurants,
                                        //           Tickets, Zones, Conversations, Messages

  // === Global (all agents see this) ===
  marketHealth: Record<string, number>; // Per-zone health scores (computed from ontology)
  activeTasks: TaskRecord[];            // All tasks currently being worked
  shiftStartTime: Date;                 // When the current shift started

  // === Current Task (set by supervisor when delegating) ===
  currentTaskId: string;
  currentTaskType: string;              // "driver_message", "support_ticket", etc.
  currentContext: Record<string, any>;  // Pre-fetched related objects from ontology

  // === Agent Communication ===
  agentMessages: AgentMessage[];        // Messages between agents
  supervisorInstructions: string;       // What the supervisor told this agent to do
  agentResult: Record<string, any>;     // What the sub-agent reports back

  // === Escalation ===
  needsEscalation: boolean;
  escalationReason: string;
    escalation_context: dict
```

### How Context Flows Between Agents

When the supervisor delegates to a sub-agent, it populates the state:

```
Supervisor:
  1. Sets current_task_id, current_task_type
  2. Fetches entity data → puts in current_entity
  3. Queries Redis for recent actions → puts in current_context
  4. Sets supervisor_instructions (what to do)

Sub-agent:
  1. Reads all the above
  2. Also reads its process .md file for rules
  3. Queries ontology objects for additional context (get_order_details, etc.)
  4. Calls ontology actions (execute_action) — validated, audited automatically
  5. Writes result back to agent_result
  6. If stuck, calls request_clarification() → sets needs_escalation = True

Supervisor:
  1. Reads agent_result
  2. Decides: done? needs follow-up? escalate to human?
```

---

## 4. Layer 2: Operational Memory (Redis)

### 4.1 Cooldown System

The core mechanism for temporal awareness. Cooldowns are **enforced at the ontology action layer** — agents don't need to check manually. When an agent calls `execute_action()`, the ontology checks Redis cooldowns automatically. If blocked, the action returns `COOLDOWN_BLOCKED` with `seconds_remaining`.

This is a critical design improvement: the agent cannot accidentally bypass cooldowns because the enforcement is systemic, not behavioral.

**Redis key pattern**: `cooldown:{entity_type}:{entity_id}:{action_type}`

**Supported cooldowns**:

| Entity | Action | Key Example | Default TTL |
|--------|--------|-------------|-------------|
| Driver | Message | `cooldown:driver:D123:message` | 300s (5 min) |
| Driver | Follow-up | `cooldown:driver:D123:followup` | 600s (10 min) |
| Driver | Call | `cooldown:driver:D123:call` | 900s (15 min) |
| Customer | Message | `cooldown:customer:C456:message` | 600s (10 min) |
| Customer | Refund notification | `cooldown:customer:C456:refund_notify` | 3600s (1 hr) |
| Order | Status change | `cooldown:order:O789:status_change` | 120s (2 min) |
| Order | Reassignment | `cooldown:order:O789:reassign` | 600s (10 min) |

**Implementation**:

```typescript
async function checkCooldown(
  redis: Redis, entityType: string, entityId: string, action: string
): Promise<CooldownResult> {
  const key = `cooldown:${entityType}:${entityId}:${action}`;
  const data = await redis.get(key);

  if (!data) return { allowed: true };

  const record = JSON.parse(data);
  const elapsed = Date.now() / 1000 - record.timestamp;
  const ttl = await redis.ttl(key);

  return {
    allowed: false,
    lastActionAt: record.timestamp,
    secondsAgo: elapsed,
    secondsRemaining: ttl,
    lastActionBy: record.agentId,
    lastActionContext: record.context,
  };
}

async function setCooldown(
  redis: Redis, entityType: string, entityId: string, action: string,
  agentId: string, ttlSeconds: number, context?: Record<string, unknown>
): Promise<void> {
  const key = `cooldown:${entityType}:${entityId}:${action}`;
  const record = { timestamp: Date.now() / 1000, agentId, context };
  await redis.set(key, JSON.stringify(record), "EX", ttlSeconds);
}
```

### 4.2 Action Timeline

Every action Sisyphus takes is recorded in a Redis sorted set, scored by timestamp. This gives any agent instant access to "what happened recently with entity X?"

**Redis key pattern**: `actions:{entity_type}:{entity_id}`

```typescript
// Record an action
await redis.zadd(
  "actions:driver:D123",
  Date.now() / 1000,
  JSON.stringify({
    action: "message_sent",
    agent: "driver_comms",
    contentPreview: "Hi John, your next pickup is at...",
    taskId: "task-abc",
    orderId: "O789",
  })
);

// Query recent actions (last 30 minutes)
const thirtyMinAgo = Date.now() / 1000 - 1800;
const recent = await redis.zrangebyscore(
  "actions:driver:D123",
  thirtyMinAgo,
  "+inf",
  "WITHSCORES"
);
// Returns: [actionJson, timestamp, actionJson, timestamp, ...]
```

**TTL**: 24 hours (actions older than today's shift are in PostgreSQL)

### 4.3 Entity Locks

Prevents two agents from modifying the same entity simultaneously.

```typescript
// Acquire lock (NX = only if not exists, EX = expiry)
const acquired = await redis.set(
  "lock:order:O789",
  JSON.stringify({ agent: "customer_support", task: "task-abc", since: Date.now() / 1000 }),
  "EX", 600,  // 10 minute max lock
  "NX"        // only if not exists
);

if (!acquired) {
  // Someone else is working this entity
  const raw = await redis.get("lock:order:O789");
  const lockHolder = JSON.parse(raw!);
  // Report to supervisor: "customer_support is already working order O789"
}
```

### 4.4 Market State Cache

Frequently-accessed market data cached to reduce API calls:

| Key | Content | TTL |
|-----|---------|-----|
| `market:{zone_id}:snapshot` | Latest dispatch snapshot | 60s |
| `market:{zone_id}:health` | Computed health score | 30s |
| `market:drivers:available` | List of available drivers | 30s |
| `market:orders:unassigned` | Unassigned order IDs | 15s |

### 4.5 Agent Heartbeats

Supervisor monitors sub-agent health:

```typescript
// Sub-agent reports heartbeat every 30s
await redis.set("heartbeat:driver_comms", String(Date.now() / 1000), "EX", 120);

// Supervisor checks
const lastBeat = await redis.get("heartbeat:driver_comms");
if (!lastBeat || (Date.now() / 1000 - parseFloat(lastBeat)) > 90) {
  // Agent appears stuck — restart or reassign its tasks
}
```

---

## 5. Layer 3: Persistent Memory (PostgreSQL)

### 5.1 Schema

```sql
-- Every action Sisyphus takes, permanently
CREATE TABLE action_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id        UUID NOT NULL,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    agent_id        TEXT NOT NULL,       -- which sub-agent
    action_type     TEXT NOT NULL,       -- message_sent, order_reassigned, ticket_resolved, etc.
    entity_type     TEXT NOT NULL,       -- driver, customer, order, ticket
    entity_id       TEXT NOT NULL,
    task_id         TEXT,                -- which task triggered this
    context         JSONB,              -- order details, conversation snippet, etc.
    outcome         TEXT,               -- success, failed, escalated
    metadata        JSONB               -- additional data (browser action, API response, etc.)
);

CREATE INDEX idx_action_log_entity ON action_log(entity_type, entity_id, timestamp DESC);
CREATE INDEX idx_action_log_shift ON action_log(shift_id, timestamp DESC);
CREATE INDEX idx_action_log_type ON action_log(action_type, timestamp DESC);

-- Shift summaries for cross-shift awareness
CREATE TABLE shift_summary (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_date      DATE NOT NULL,
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ,
    total_actions   INT DEFAULT 0,
    orders_handled  INT DEFAULT 0,
    tickets_resolved INT DEFAULT 0,
    messages_sent   INT DEFAULT 0,
    escalations     INT DEFAULT 0,
    issues          JSONB,             -- unresolved issues to hand off
    notes           TEXT,              -- free-text shift summary
    market_summary  JSONB              -- aggregate market health over the shift
);

-- Entity interaction history (for "this customer called before" awareness)
CREATE TABLE entity_interactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    interaction_type TEXT NOT NULL,     -- contacted, resolved_ticket, refunded, escalated
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    summary         TEXT,              -- brief description
    sentiment       TEXT,              -- positive, neutral, negative, angry
    resolved        BOOLEAN DEFAULT FALSE,
    context         JSONB
);

CREATE INDEX idx_entity_interactions ON entity_interactions(entity_type, entity_id, timestamp DESC);
```

### 5.2 Cross-Shift Awareness

At the start of each shift, Sisyphus loads:

1. **Yesterday's shift summary**: Unresolved issues, handoff notes
2. **Recent entity interactions**: Last 7 days of interactions for any entity it touches
3. **Pattern data**: Repeat offenders (customers with many tickets), problematic restaurants

This means Sisyphus knows: "This customer had a complaint yesterday that was partially resolved — handle with extra care."

### 5.3 Querying Memory

Agents access persistent memory through a set of tools:

```typescript
// Tool: getEntityHistory
async function getEntityHistory(entityType: string, entityId: string, days = 7) {
  return db.select()
    .from(entityInteractions)
    .where(
      and(
        eq(entityInteractions.entityType, entityType),
        eq(entityInteractions.entityId, entityId),
        gt(entityInteractions.timestamp, sql`NOW() - INTERVAL '${days} days'`)
      )
    )
    .orderBy(desc(entityInteractions.timestamp))
    .limit(20);
}

// Tool: getShiftHandoff
async function getShiftHandoff() {
  return db.select()
    .from(shiftSummary)
    .where(eq(shiftSummary.shiftDate, sql`CURRENT_DATE - 1`))
    .orderBy(desc(shiftSummary.endTime))
    .limit(1);
```

> **Note:** SQL examples below use raw SQL for clarity. The actual implementation uses
> Drizzle ORM as shown above, which provides full type safety from schema to query result.

```
// Equivalent raw SQL for reference:
// getEntityHistory:
//   SELECT timestamp, interaction_type, summary, sentiment, resolved
//   FROM entity_interactions
//   WHERE entity_type = $1 AND entity_id = $2
//     AND timestamp > NOW() - INTERVAL '$3 days'
//   ORDER BY timestamp DESC LIMIT 20
//
// getShiftHandoff:
//   SELECT issues, notes, market_summary
//   FROM shift_summary
//   WHERE shift_date = CURRENT_DATE - 1
//   ORDER BY end_time DESC
//   LIMIT 1
```

---

## 6. Context Sharing: Multi-Agent Same-Task Scenario

### The Problem

Two agents might work the same task. For example:
- Customer Support Agent resolves a ticket about order #789
- Driver Comms Agent needs to message the driver about the same order

Both need to know what the other has done.

### The Solution: Task Context Object

Each task has a shared context object in LangGraph state + Redis:

```typescript
interface TaskContext {
  taskId: string;
  entityIds: string[];           // All related entities
  actionsTaken: Action[];        // What's been done so far
  currentOwner: string;          // Which agent is primary
  collaborators: string[];       // Which agents have touched this
  notes: string[];               // Free-text notes from agents
  status: "pending" | "in_progress" | "blocked" | "resolved";
  createdAt: Date;
  updatedAt: Date;
}
```

**Redis key**: `task:{task_id}:context` (JSON, TTL 24h)

When an agent picks up a task:
1. Read `task:{task_id}:context` from Redis
2. See all prior actions and notes from other agents
3. Add own actions to the context as it works
4. On completion, write final status

This prevents: "I already refunded this customer but the Driver Comms agent doesn't know and is still apologizing for the delay."

---

## 7. Temporal Awareness Summary

| Question | How Sisyphus Answers It |
|----------|------------------------|
| "Did I just message this driver?" | Redis cooldown check |
| "When was the last action on this order?" | Redis action timeline |
| "Is another agent working on this?" | Redis entity lock check |
| "Has this customer called before?" | PostgreSQL entity interactions |
| "What happened on yesterday's shift?" | PostgreSQL shift summary |
| "What's the current market state?" | Redis market cache → S3 snapshot |
| "What has been done on this task so far?" | Redis task context + LangGraph state |
| "Is my sub-agent still alive?" | Redis heartbeat check |

---

## 8. Memory Lifecycle

```
Action occurs
    │
    ├── Immediately: Written to LangGraph state (working memory)
    │
    ├── Immediately: Written to Redis (operational memory)
    │   ├── Cooldown set with TTL
    │   ├── Action added to entity timeline
    │   └── Task context updated
    │
    ├── Async (within seconds): Written to PostgreSQL (persistent memory)
    │   ├── Action log entry
    │   └── Entity interaction record
    │
    └── End of shift: Aggregated into shift summary
        ├── Unresolved issues flagged for next shift
        └── Statistics computed and stored
```

---

## 9. Data Retention

| Memory Layer | Retention | Cleanup |
|-------------|-----------|---------|
| LangGraph state | Current execution | Cleared on task completion |
| Redis cooldowns | TTL-based (5-60 min) | Auto-expires |
| Redis action timelines | 24 hours | TTL auto-cleanup |
| Redis entity locks | 10 min max | TTL auto-cleanup |
| PostgreSQL action_log | 90 days | Archived then deleted |
| PostgreSQL entity_interactions | 1 year | Archived then deleted |
| PostgreSQL shift_summary | Indefinite | Kept for analytics |
