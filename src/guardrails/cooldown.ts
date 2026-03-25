/**
 * Cooldown enforcement (Redis-backed temporal guardrail).
 *
 * Prevents the same action from being repeated on the same entity before the
 * cooldown period elapses. The agent never has to check manually — the
 * execution pipeline calls these functions automatically.
 *
 * Key pattern: cooldown:{entityType}:{entityId}:{action}
 *
 * @see planning/04-memory-system.md section 4.1
 */

import type { Redis } from "ioredis";
import type { CooldownResult } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cooldownKey(
  entityType: string,
  entityId: string,
  action: string,
): string {
  return `cooldown:${entityType}:${entityId}:${action}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a cooldown is currently active for the given entity + action.
 */
export async function checkCooldown(
  redis: Redis,
  entityType: string,
  entityId: string,
  action: string,
): Promise<CooldownResult> {
  const key = cooldownKey(entityType, entityId, action);
  const data = await redis.get(key);

  if (!data) {
    return { allowed: true };
  }

  const record: { timestamp: number; agentId: string; context?: Record<string, unknown> } =
    JSON.parse(data);

  const ttl = await redis.ttl(key);

  return {
    allowed: false,
    secondsRemaining: ttl > 0 ? ttl : undefined,
    lastActionBy: record.agentId,
  };
}

/**
 * Set (or reset) a cooldown after an action is successfully executed.
 */
export async function setCooldown(
  redis: Redis,
  entityType: string,
  entityId: string,
  action: string,
  agentId: string,
  ttlSeconds: number,
  context?: Record<string, unknown>,
): Promise<void> {
  const key = cooldownKey(entityType, entityId, action);
  const record = {
    timestamp: Date.now() / 1000,
    agentId,
    context: context ?? null,
  };
  await redis.set(key, JSON.stringify(record), "EX", ttlSeconds);
}
