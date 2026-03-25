export { createRedisClient, type RedisClient } from "./client.js";

export {
  recordAction,
  getRecentActions,
  type TimelineAction,
  type ScoredAction,
} from "./action-timeline.js";

export {
  acquireLock,
  releaseLock,
  getLockHolder,
  type LockPayload,
  type AcquireResult,
} from "./locks.js";

export {
  sendHeartbeat,
  checkHeartbeat,
  type HeartbeatStatus,
} from "./heartbeat.js";

export { cacheGet, cacheSet, cacheDelete } from "./cache.js";
