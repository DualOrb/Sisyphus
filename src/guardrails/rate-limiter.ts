/**
 * Rate limiter (Redis sorted-set sliding window).
 *
 * Enforces per-agent, per-action rate limits using a sliding window over
 * the last hour. Each invocation is stored as a member in a sorted set
 * scored by timestamp. Expired entries are pruned on every check.
 *
 * Key pattern: ratelimit:{agentId}:{actionName}
 *
 * @see planning/09-ontology-layer-design.md section 6.3
 */

import type { Redis } from "ioredis";
import type { RateLimitConfig, RateLimitResult } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WINDOW_SECONDS = 3600; // 1 hour sliding window

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rateLimitKey(agentId: string, actionName: string): string {
  return `ratelimit:${agentId}:${actionName}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether the agent is within rate limits for a given action.
 *
 * If allowed, the current invocation is recorded in the sorted set so it
 * counts toward the window. If denied, nothing is recorded.
 */
export async function checkRateLimit(
  redis: Redis,
  agentId: string,
  actionName: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const key = rateLimitKey(agentId, actionName);
  const now = Date.now() / 1000;
  const windowStart = now - WINDOW_SECONDS;

  // Remove entries older than the sliding window
  await redis.zremrangebyscore(key, "-inf", windowStart);

  // Count remaining entries in the window
  const count = await redis.zcard(key);

  if (count >= config.maxPerHour) {
    // Find the oldest entry still in the window to compute reset time
    const oldest = await redis.zrange(key, 0, 0, "WITHSCORES");
    const oldestScore = oldest.length >= 2 ? parseFloat(oldest[1]) : now;
    const resetIn = Math.ceil(oldestScore + WINDOW_SECONDS - now);

    return {
      allowed: false,
      remaining: 0,
      resetIn: Math.max(resetIn, 0),
    };
  }

  // Record this invocation (use timestamp as both score and a unique-enough member)
  const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
  await redis.zadd(key, now, member);

  // Set a TTL on the whole key so it auto-cleans if the agent goes idle
  await redis.expire(key, WINDOW_SECONDS);

  return {
    allowed: true,
    remaining: config.maxPerHour - count - 1,
    resetIn: WINDOW_SECONDS,
  };
}
