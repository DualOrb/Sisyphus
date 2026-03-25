import Redis from "ioredis";
import { createChildLogger } from "../../lib/index.js";

const log = createChildLogger("redis");

export type RedisClient = Redis;

/**
 * Create a Redis client with auto-reconnect and error logging.
 *
 * @param url - Redis connection string (e.g. "redis://localhost:6379/0")
 * @returns Connected ioredis instance
 */
export function createRedisClient(url: string): RedisClient {
  const client = new Redis(url, {
    maxRetriesPerRequest: null, // required for BullMQ compatibility, also avoids throwing on transient errors
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5_000);
      log.warn({ attempt: times, delayMs: delay }, "Redis reconnecting");
      return delay;
    },
    reconnectOnError(err) {
      const target = err.message;
      // Reconnect on READONLY errors (e.g. during failover)
      if (target.includes("READONLY")) {
        return true;
      }
      return false;
    },
  });

  client.on("connect", () => {
    log.info("Redis connected");
  });

  client.on("ready", () => {
    log.info("Redis ready");
  });

  client.on("error", (err) => {
    log.error({ err }, "Redis error");
  });

  client.on("close", () => {
    log.warn("Redis connection closed");
  });

  return client;
}
