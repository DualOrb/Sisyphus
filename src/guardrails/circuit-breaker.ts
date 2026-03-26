/**
 * Circuit breaker — pauses agents that trigger too many failures.
 *
 * Thresholds:
 *   > 10 failures in  5 min = agent paused, supervisor notified
 *   > 15 failures in 15 min = agent paused, human alerted
 *
 * Uses a Redis sorted set scored by timestamp so we can count failures
 * within arbitrary time windows.
 *
 * Key pattern: circuitbreaker:{agentId}
 */

import type { Redis } from "ioredis";
import type { CircuitBreakerResult } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHORT_WINDOW_SECONDS = 300; // 5 minutes
const LONG_WINDOW_SECONDS = 900; // 15 minutes
const SHORT_WINDOW_THRESHOLD = 10;
const LONG_WINDOW_THRESHOLD = 15;

// Key TTL — keep failure records for the length of the longer window + buffer
const KEY_TTL_SECONDS = LONG_WINDOW_SECONDS + 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cbKey(agentId: string): string {
  return `circuitbreaker:${agentId}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a failed action execution for an agent.
 */
export async function recordFailure(
  redis: Redis,
  agentId: string,
): Promise<void> {
  const key = cbKey(agentId);
  const now = Date.now() / 1000;
  const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;

  await redis.zadd(key, now, member);
  await redis.expire(key, KEY_TTL_SECONDS);
}

/**
 * Record a successful action execution for an agent.
 * Resets the failure counter (clears the sorted set).
 */
export async function recordSuccess(
  redis: Redis,
  agentId: string,
): Promise<void> {
  const key = cbKey(agentId);
  await redis.del(key);
}

/**
 * Check whether the circuit breaker is open (agent should be paused).
 */
export async function isCircuitOpen(
  redis: Redis,
  agentId: string,
): Promise<CircuitBreakerResult> {
  const key = cbKey(agentId);
  const now = Date.now() / 1000;

  // Prune entries older than the long window
  await redis.zremrangebyscore(key, "-inf", now - LONG_WINDOW_SECONDS);

  // Count failures in the long window (15 min)
  const longCount = await redis.zcard(key);

  if (longCount > LONG_WINDOW_THRESHOLD) {
    return {
      open: true,
      failureCount: longCount,
      message: `Agent "${agentId}" has ${longCount} failures in the last 15 minutes — paused, human alert required`,
    };
  }

  // Count failures in the short window (5 min)
  const shortWindowStart = now - SHORT_WINDOW_SECONDS;
  const shortCount = await redis.zcount(key, shortWindowStart, "+inf");

  if (shortCount > SHORT_WINDOW_THRESHOLD) {
    return {
      open: true,
      failureCount: shortCount,
      message: `Agent "${agentId}" has ${shortCount} failures in the last 5 minutes — paused, supervisor notified`,
    };
  }

  return {
    open: false,
    failureCount: longCount,
  };
}
