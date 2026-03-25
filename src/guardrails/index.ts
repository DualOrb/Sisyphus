// Guardrails — action registry, validation, and execution pipeline.

// Types
export {
  Tier,
  type ActionOutcome,
  type ActionResult,
  type ValidationError,
  type ValidationResult,
  type SubmissionCriterion,
  type CooldownConfig,
  type CooldownResult,
  type RateLimitConfig,
  type RateLimitResult,
  type CircuitBreakerResult,
  type AuditRecord,
  type ExecutionMethod,
  type ActionDefinition,
  type ExecutionContext,
} from "./types.js";

// Registry
export { defineAction, getAction, listActions, clearActions } from "./registry.js";

// Validator
export { validateSubmissionCriteria } from "./validator.js";

// Cooldown
export { checkCooldown, setCooldown } from "./cooldown.js";

// Rate limiter
export { checkRateLimit } from "./rate-limiter.js";

// Circuit breaker
export { recordFailure, recordSuccess, isCircuitOpen } from "./circuit-breaker.js";

// Executor (the single entry point for agents)
export { executeAction } from "./executor.js";
