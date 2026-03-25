import type { RedisClient } from "./client.js";

/** Default lock TTL: 10 minutes. */
const DEFAULT_LOCK_TTL_SECONDS = 600;

/**
 * Build the Redis key for an entity lock.
 */
function lockKey(entityType: string, entityId: string): string {
  return `lock:${entityType}:${entityId}`;
}

export interface LockPayload {
  agentId: string;
  since: number;
  taskId?: string;
}

export interface AcquireResult {
  acquired: boolean;
  holder?: LockPayload;
}

/**
 * Attempt to acquire an exclusive lock on an entity.
 * Uses SET NX to guarantee atomicity.
 *
 * @returns `{ acquired: true }` on success, or `{ acquired: false, holder }` if already locked.
 */
export async function acquireLock(
  redis: RedisClient,
  entityType: string,
  entityId: string,
  agentId: string,
  ttlSeconds = DEFAULT_LOCK_TTL_SECONDS,
  taskId?: string,
): Promise<AcquireResult> {
  const key = lockKey(entityType, entityId);
  const payload: LockPayload = {
    agentId,
    since: Date.now() / 1000,
    taskId,
  };

  const result = await redis.set(key, JSON.stringify(payload), "EX", ttlSeconds, "NX");

  if (result === "OK") {
    return { acquired: true };
  }

  // Lock is held by someone else — return current holder info
  const holder = await getLockHolder(redis, entityType, entityId);
  return { acquired: false, holder: holder ?? undefined };
}

/**
 * Release a lock only if the calling agent owns it.
 * Uses a Lua script for atomic check-and-delete.
 *
 * @returns `true` if the lock was released, `false` if not owned or already expired.
 */
export async function releaseLock(
  redis: RedisClient,
  entityType: string,
  entityId: string,
  agentId: string,
): Promise<boolean> {
  const key = lockKey(entityType, entityId);

  // Atomic: read → verify owner → delete
  const lua = `
    local data = redis.call("GET", KEYS[1])
    if not data then return 0 end
    local payload = cjson.decode(data)
    if payload.agentId == ARGV[1] then
      redis.call("DEL", KEYS[1])
      return 1
    end
    return 0
  `;

  const result = await redis.eval(lua, 1, key, agentId);
  return result === 1;
}

/**
 * Get the current holder of an entity lock, if any.
 */
export async function getLockHolder(
  redis: RedisClient,
  entityType: string,
  entityId: string,
): Promise<LockPayload | null> {
  const key = lockKey(entityType, entityId);
  const raw = await redis.get(key);

  if (!raw) return null;
  return JSON.parse(raw) as LockPayload;
}
