import type { RedisClient } from "./client.js";

/**
 * Get a cached value by key, JSON-parsed to type T.
 *
 * @returns The parsed value, or `null` if the key does not exist.
 */
export async function cacheGet<T = unknown>(
  redis: RedisClient,
  key: string,
): Promise<T | null> {
  const raw = await redis.get(key);
  if (raw === null) return null;
  return JSON.parse(raw) as T;
}

/**
 * Set a cached value as JSON-stringified with a TTL.
 */
export async function cacheSet(
  redis: RedisClient,
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

/**
 * Delete a cached key.
 */
export async function cacheDelete(
  redis: RedisClient,
  key: string,
): Promise<void> {
  await redis.del(key);
}
