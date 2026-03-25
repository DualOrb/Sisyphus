// Redis — operational memory (cooldowns, timelines, locks, heartbeats, cache)
export {
  createRedisClient,
  type RedisClient,
  recordAction,
  getRecentActions,
  type TimelineAction,
  type ScoredAction,
  acquireLock,
  releaseLock,
  getLockHolder,
  type LockPayload,
  type AcquireResult,
  sendHeartbeat,
  checkHeartbeat,
  type HeartbeatStatus,
  cacheGet,
  cacheSet,
  cacheDelete,
} from "./redis/index.js";

// PostgreSQL — persistent memory (audit log, shift summaries, entity interactions)
export {
  createPostgresClient,
  type PostgresDb,
  getEntityHistory,
  getShiftHandoff,
  writeAuditRecord,
  writeShiftSummary,
} from "./postgres/index.js";

// DynaClone — read-only MySQL replica of DynamoDB (joins, aggregations)
export {
  DynaCloneClient,
  type DynaCloneConnectionConfig,
  type SecretsLookupFn,
  getActiveDriversOnShift,
  getAvailableOnCallDrivers,
  getPredictedDriverCount,
  getOrderSubtotal,
  getDriverDeliveryStats,
  type ActiveDriverOnShift,
  type OnCallDriver,
  type PredictedDriverCount,
  type OrderSubtotalRow,
  type DriverDeliveryStats,
  fixDynacloneArrays,
  parseIntField,
  parseBoolField,
  epochToDate,
} from "./dynaclone/index.js";
