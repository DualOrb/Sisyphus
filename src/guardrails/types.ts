/**
 * Core types for the Sisyphus guardrails system.
 *
 * Every mutation flows through typed ActionDefinitions with submission criteria,
 * cooldowns, rate limits, and autonomy tiers. These types define the contract.
 *
 * @see planning/09-ontology-layer-design.md sections 4-6
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Autonomy tiers
// ---------------------------------------------------------------------------

export enum Tier {
  /** Auto-execute. Safe, reversible, low-impact. */
  GREEN = "GREEN",
  /** Auto-execute, logged prominently and visible to dispatchers in real-time. */
  YELLOW = "YELLOW",
  /** Staged for review during ramp-up; auto-execute once confidence is established. */
  ORANGE = "ORANGE",
  /** Always requires human approval. */
  RED = "RED",
}

// ---------------------------------------------------------------------------
// Action results
// ---------------------------------------------------------------------------

export type ActionOutcome =
  | "executed"
  | "rejected"
  | "staged"
  | "cooldown_blocked"
  | "rate_limited"
  | "circuit_broken";

export interface ActionResult {
  success: boolean;
  outcome: ActionOutcome;
  reason?: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  rule: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface ValidationResult {
  passed: boolean;
  errors: ValidationError[];
}

// ---------------------------------------------------------------------------
// Submission criterion — a single check run before action execution
// ---------------------------------------------------------------------------

export interface SubmissionCriterion {
  name: string;
  /** Returns { passed, message? } given the action params and current world state. */
  check: (
    params: Record<string, unknown>,
    state: Record<string, unknown>,
  ) => { passed: boolean; message?: string };
}

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

export interface CooldownConfig {
  /** Entity type the cooldown is scoped to (e.g. "order", "driver"). */
  entity: string;
  /** Action slug used in the Redis key (e.g. "assign", "message"). */
  action: string;
  /** Time-to-live in seconds. */
  ttlSeconds: number;
}

export interface CooldownResult {
  allowed: boolean;
  secondsRemaining?: number;
  lastActionBy?: string;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  /** Maximum invocations allowed per rolling hour. */
  maxPerHour: number;
  /** Whether the limit is per-entity or a global total for the agent. */
  scope: "per_entity" | "total";
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

export interface CircuitBreakerResult {
  open: boolean;
  failureCount: number;
  message?: string;
}

// ---------------------------------------------------------------------------
// Audit trail (immutable record per planning/09 section 6.5)
// ---------------------------------------------------------------------------

export interface AuditRecord {
  id: string;
  timestamp: Date;
  actionType: string;
  agentId: string;
  params: Record<string, unknown>;
  reasoning: string;
  submissionCheck: Record<string, unknown>;
  outcome: ActionOutcome;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  sideEffectsFired: string[];
  executionTimeMs: number;
  llmModel: string;
  llmTokensUsed: number;
  correlationId: string;
}

// ---------------------------------------------------------------------------
// Action definition — the registry entry for every mutation in the system
// ---------------------------------------------------------------------------

export type ExecutionMethod = "browser" | "api" | "internal";

export interface ActionDefinition<TParams = Record<string, unknown>> {
  /** Unique action name, e.g. "AssignDriverToOrder". */
  name: string;
  /** Human-readable description of what this action does. */
  description: string;
  /** Autonomy tier governing execution policy. */
  tier: Tier;
  /** Zod schema that validates the action parameters. */
  paramsSchema: z.ZodType<TParams>;
  /** Submission criteria checked before execution. */
  criteria: SubmissionCriterion[];
  /** Optional cooldown configuration. */
  cooldown?: CooldownConfig;
  /** Optional rate-limit configuration. */
  rateLimit?: RateLimitConfig;
  /** How the action is executed downstream. */
  execution: ExecutionMethod;
  /** Side-effect labels fired after successful execution (for audit trail). */
  sideEffects?: string[];
}

// ---------------------------------------------------------------------------
// Executor context — passed into the execution pipeline
// ---------------------------------------------------------------------------

export interface ExecutionContext {
  /** Redis instance for cooldowns, rate limits, circuit breaker. */
  redis: import("ioredis").Redis;
  /** Current ontology/world state used by submission criteria. */
  state?: Record<string, unknown>;
  /** Correlation ID linking related actions together. */
  correlationId?: string;
  /** LLM model that made the decision (for audit). */
  llmModel?: string;
  /** Token count from the LLM call (for audit). */
  llmTokensUsed?: number;
  /** Callback invoked with the AuditRecord after execution. */
  onAudit?: (record: AuditRecord) => void | Promise<void>;
}
