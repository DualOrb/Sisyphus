import type { RedisClient } from "./client.js";

/** Heartbeat TTL: 120 seconds. Agents should send every ~30s. */
const HEARTBEAT_TTL_SECONDS = 120;

/**
 * Build the Redis key for an agent's heartbeat.
 */
function heartbeatKey(agentId: string): string {
  return `heartbeat:${agentId}`;
}

export interface HeartbeatStatus {
  alive: boolean;
  lastSeenSecondsAgo?: number;
}

/**
 * Record a heartbeat for an agent. Set with a 120s TTL so stale agents auto-expire.
 */
export async function sendHeartbeat(
  redis: RedisClient,
  agentId: string,
): Promise<void> {
  const key = heartbeatKey(agentId);
  await redis.set(key, String(Date.now() / 1000), "EX", HEARTBEAT_TTL_SECONDS);
}

/**
 * Check whether an agent is alive based on its heartbeat.
 *
 * @returns `{ alive: true, lastSeenSecondsAgo }` or `{ alive: false }`.
 */
export async function checkHeartbeat(
  redis: RedisClient,
  agentId: string,
): Promise<HeartbeatStatus> {
  const key = heartbeatKey(agentId);
  const raw = await redis.get(key);

  if (!raw) {
    return { alive: false };
  }

  const lastBeat = parseFloat(raw);
  const secondsAgo = Date.now() / 1000 - lastBeat;

  return {
    alive: true,
    lastSeenSecondsAgo: Math.round(secondsAgo),
  };
}
