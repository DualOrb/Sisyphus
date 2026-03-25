import type { RedisClient } from "./client.js";

/** 24 hours in seconds — timeline keys expire after one day. */
const TIMELINE_TTL_SECONDS = 86_400;

/**
 * Build the sorted-set key for an entity's action timeline.
 */
function timelineKey(entityType: string, entityId: string): string {
  return `actions:${entityType}:${entityId}`;
}

export interface TimelineAction {
  action: string;
  agent?: string;
  taskId?: string;
  contentPreview?: string;
  [key: string]: unknown;
}

/**
 * Record an action to an entity's timeline (sorted set scored by Unix epoch seconds).
 * Automatically refreshes the 24-hour TTL on the key.
 */
export async function recordAction(
  redis: RedisClient,
  entityType: string,
  entityId: string,
  action: TimelineAction,
): Promise<void> {
  const key = timelineKey(entityType, entityId);
  const score = Date.now() / 1000;
  const member = JSON.stringify({ ...action, ts: score });

  await redis.zadd(key, score, member);
  await redis.expire(key, TIMELINE_TTL_SECONDS);
}

export interface ScoredAction {
  action: TimelineAction;
  timestamp: number;
}

/**
 * Retrieve recent actions for an entity within the last `minutes` (default 30).
 * Returns actions sorted oldest-first.
 */
export async function getRecentActions(
  redis: RedisClient,
  entityType: string,
  entityId: string,
  minutes = 30,
): Promise<ScoredAction[]> {
  const key = timelineKey(entityType, entityId);
  const minScore = Date.now() / 1000 - minutes * 60;

  const raw = await redis.zrangebyscore(key, minScore, "+inf", "WITHSCORES");

  // raw comes back as [member, score, member, score, ...]
  const results: ScoredAction[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    results.push({
      action: JSON.parse(raw[i]) as TimelineAction,
      timestamp: parseFloat(raw[i + 1]),
    });
  }

  return results;
}
