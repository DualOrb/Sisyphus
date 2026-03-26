/**
 * Guardrails execution pipeline — the SINGLE entry point agents call.
 *
 * Pipeline stages:
 *   1. Look up action definition
 *   2. Validate params (Zod schema)
 *   3. Check cooldown
 *   4. Check rate limit
 *   5. Check circuit breaker
 *   6. Validate submission criteria
 *   7. Check autonomy tier (auto-execute vs stage)
 *   8. Execute (TODO: real browser/API execution)
 *   9. Set cooldown
 *  10. Log audit record
 *  11. Return result
 *
 * @see planning/09-ontology-layer-design.md section 7.1 (executeAction tool)
 */

import { randomUUID } from "node:crypto";
import { getAction } from "./registry.js";
import { validateSubmissionCriteria } from "./validator.js";
import { checkCooldown, setCooldown } from "./cooldown.js";
import { checkRateLimit } from "./rate-limiter.js";
import {
  isCircuitOpen,
  recordFailure,
  recordSuccess,
} from "./circuit-breaker.js";
import type {
  ActionResult,
  AuditRecord,
  ExecutionContext,
  Tier,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Snapshot the relevant entity from the OntologyStore before/after execution.
 * The `state` in ExecutionContext is the OntologyStore cast as Record<string, unknown>.
 * We detect the entity type from the action params and snapshot accordingly.
 */
function snapshotEntityState(
  state: Record<string, unknown> | undefined,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (!state) return {};

  try {
    // Try order
    const orderId = params.orderId ?? params.order_id;
    if (orderId && typeof orderId === "string" && typeof (state as any).getOrder === "function") {
      const order = (state as any).getOrder(orderId);
      if (order) return JSON.parse(JSON.stringify(order));
    }

    // Try driver
    const driverId = params.driverId ?? params.driver_id;
    if (driverId && typeof driverId === "string" && typeof (state as any).getDriver === "function") {
      const driver = (state as any).getDriver(driverId);
      if (driver) return JSON.parse(JSON.stringify(driver));
    }

    // Try ticket
    const ticketId = params.ticketId ?? params.ticket_id ?? params.issueId ?? params.issue_id;
    if (ticketId && typeof ticketId === "string" && typeof (state as any).getTicket === "function") {
      const ticket = (state as any).getTicket(ticketId);
      if (ticket) return JSON.parse(JSON.stringify(ticket));
    }

    // Try market
    const market = params.market ?? params.zone;
    if (market && typeof market === "string" && typeof (state as any).getMarket === "function") {
      const marketEntity = (state as any).getMarket(market);
      if (marketEntity) return JSON.parse(JSON.stringify(marketEntity));
    }
  } catch {
    // Snapshot is best-effort; never block execution
  }

  return {};
}

/**
 * Resolve a cooldown entity ID from action params.
 *
 * When a CooldownConfig specifies entity = "order", we look for `order_id`
 * or `orderId` in the params. This keeps the convention flexible without
 * requiring each action to provide a custom resolver.
 */
function resolveCooldownEntityId(
  entity: string,
  params: Record<string, unknown>,
): string | undefined {
  // Try snake_case and camelCase variants
  const snakeKey = `${entity}_id`;
  const camelKey = `${entity}Id`;
  const val = params[snakeKey] ?? params[camelKey] ?? params[entity];
  return typeof val === "string" ? val : undefined;
}

/**
 * Determine whether a tier allows autonomous execution.
 * GREEN and YELLOW auto-execute; ORANGE is staged; RED requires human approval.
 */
function shouldAutoExecute(tier: Tier): boolean {
  return tier === "GREEN" || tier === "YELLOW";
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function executeAction(
  name: string,
  params: Record<string, unknown>,
  reasoning: string,
  agentId: string,
  context: ExecutionContext,
): Promise<ActionResult> {
  const startTime = Date.now();
  const { redis, state = {}, correlationId, onAudit } = context;

  // 1. Look up action definition
  const action = getAction(name);
  if (!action) {
    return {
      success: false,
      outcome: "rejected",
      reason: `Unknown action "${name}". It must be registered via defineAction() before use.`,
    };
  }

  // 2. Validate params with Zod
  const parseResult = action.paramsSchema.safeParse(params);
  if (!parseResult.success) {
    const formatted = parseResult.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    await recordFailure(redis, agentId);
    return {
      success: false,
      outcome: "rejected",
      reason: `Invalid parameters: ${formatted}`,
    };
  }

  const validatedParams = parseResult.data as Record<string, unknown>;

  // 3. Check cooldown
  if (action.cooldown) {
    const entityId = resolveCooldownEntityId(action.cooldown.entity, validatedParams);
    if (entityId) {
      const cooldownResult = await checkCooldown(
        redis,
        action.cooldown.entity,
        entityId,
        action.cooldown.action,
      );
      if (!cooldownResult.allowed) {
        return {
          success: false,
          outcome: "cooldown_blocked",
          reason: `Cooldown active for ${action.cooldown.entity}:${entityId}:${action.cooldown.action}. ${
            cooldownResult.secondsRemaining
              ? `${cooldownResult.secondsRemaining}s remaining.`
              : ""
          }${
            cooldownResult.lastActionBy
              ? ` Last action by "${cooldownResult.lastActionBy}".`
              : ""
          }`.trim(),
        };
      }
    }
  }

  // 4. Check rate limit
  if (action.rateLimit) {
    const rlResult = await checkRateLimit(
      redis,
      agentId,
      action.name,
      action.rateLimit,
    );
    if (!rlResult.allowed) {
      return {
        success: false,
        outcome: "rate_limited",
        reason: `Rate limit exceeded for "${action.name}". Resets in ${rlResult.resetIn}s.`,
      };
    }
  }

  // 5. Check circuit breaker
  const cbResult = await isCircuitOpen(redis, agentId);
  if (cbResult.open) {
    return {
      success: false,
      outcome: "circuit_broken",
      reason: cbResult.message ?? `Agent "${agentId}" is paused due to repeated failures.`,
    };
  }

  // 6. Validate submission criteria
  const validation = validateSubmissionCriteria(action, validatedParams, state);
  if (!validation.passed) {
    await recordFailure(redis, agentId);
    const reasons = validation.errors.map((e) => `[${e.rule}] ${e.message}`).join("; ");
    return {
      success: false,
      outcome: "rejected",
      reason: `Submission criteria failed: ${reasons}`,
    };
  }

  // 7. Snapshot entity state BEFORE execution
  const beforeState = snapshotEntityState(state as Record<string, unknown> | undefined, validatedParams);

  // 8. Check autonomy tier
  if (!shouldAutoExecute(action.tier as Tier)) {
    // ORANGE and RED actions are staged for review
    const auditRecord = buildAuditRecord({
      action,
      agentId,
      params: validatedParams,
      reasoning,
      validation,
      outcome: "staged",
      startTime,
      context,
      beforeState,
      afterState: beforeState, // No mutation for staged actions
    });
    await onAudit?.(auditRecord);

    return {
      success: true,
      outcome: "staged",
      reason: `Action "${name}" (tier ${action.tier}) has been staged for ${
        action.tier === "RED" ? "human approval" : "review"
      }.`,
      data: { auditId: auditRecord.id },
    };
  }

  // 9. Execute the action
  // TODO: Wire real browser/API executors here based on action.execution.
  // For now we treat every action as successfully executed once it passes all checks.

  // 10. Set cooldown after successful execution
  if (action.cooldown) {
    const entityId = resolveCooldownEntityId(action.cooldown.entity, validatedParams);
    if (entityId) {
      await setCooldown(
        redis,
        action.cooldown.entity,
        entityId,
        action.cooldown.action,
        agentId,
        action.cooldown.ttlSeconds,
      );
    }
  }

  // Record success (resets circuit breaker)
  await recordSuccess(redis, agentId);

  // 11. Snapshot entity state AFTER execution (same as before in shadow mode)
  const afterState = snapshotEntityState(state as Record<string, unknown> | undefined, validatedParams);

  // 12. Build and emit audit record
  const auditRecord = buildAuditRecord({
    action,
    agentId,
    params: validatedParams,
    reasoning,
    validation,
    outcome: "executed",
    startTime,
    context,
    beforeState,
    afterState,
  });
  await onAudit?.(auditRecord);

  // 13. Return result
  return {
    success: true,
    outcome: "executed",
    data: { auditId: auditRecord.id },
  };
}

// ---------------------------------------------------------------------------
// Audit record builder
// ---------------------------------------------------------------------------

interface AuditBuildInput {
  action: ReturnType<typeof getAction> & {};
  agentId: string;
  params: Record<string, unknown>;
  reasoning: string;
  validation: { passed: boolean; errors: { rule: string; message: string }[] };
  outcome: AuditRecord["outcome"];
  startTime: number;
  context: ExecutionContext;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
}

function buildAuditRecord(input: AuditBuildInput): AuditRecord {
  const {
    action,
    agentId,
    params,
    reasoning,
    validation,
    outcome,
    startTime,
    context,
  } = input;

  const submissionCheck: Record<string, unknown> = {};
  for (const criterion of action.criteria) {
    const matchingError = validation.errors.find((e) => e.rule === criterion.name);
    submissionCheck[criterion.name] = matchingError
      ? { passed: false, message: matchingError.message }
      : { passed: true };
  }

  return {
    id: randomUUID(),
    timestamp: new Date(),
    actionType: action.name,
    agentId,
    params,
    reasoning,
    submissionCheck,
    outcome,
    beforeState: input.beforeState ?? {},
    afterState: input.afterState ?? {},
    sideEffectsFired: outcome === "executed" ? (action.sideEffects ?? []) : [],
    executionTimeMs: Date.now() - startTime,
    llmModel: context.llmModel ?? "unknown",
    llmTokensUsed: context.llmTokensUsed ?? 0,
    correlationId: context.correlationId ?? randomUUID(),
  };
}
