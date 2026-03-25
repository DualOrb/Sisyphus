/**
 * Health check implementations for Sisyphus subsystems.
 *
 * Each check returns a ComponentHealth with latency, status, and details.
 * All checks have a configurable timeout (default 5s) and catch errors gracefully.
 */

import http from "node:http";
import type { RedisClient } from "../memory/redis/client.js";
import type { PostgresDb } from "../memory/postgres/client.js";
import type { OntologyStore } from "../ontology/state/store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface ComponentHealth {
  name: string;
  status: HealthStatus;
  latencyMs?: number;
  details?: string;
  lastChecked: Date;
}

export interface SystemHealth {
  status: HealthStatus;
  uptime: number;
  components: ComponentHealth[];
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5_000;
const processStartTime = Date.now();

/** Run a check function with a timeout. Returns unhealthy on timeout or error. */
async function withTimeout<T>(
  name: string,
  fn: () => Promise<ComponentHealth>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ComponentHealth> {
  try {
    const result = await Promise.race([
      fn(),
      new Promise<ComponentHealth>((_, reject) =>
        setTimeout(() => reject(new Error(`Health check "${name}" timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    return result;
  } catch (err) {
    return {
      name,
      status: "unhealthy",
      details: err instanceof Error ? err.message : String(err),
      lastChecked: new Date(),
    };
  }
}

/** Make a simple HTTP GET and return the status code. */
function httpGet(url: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = http.get(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 80,
        path: parsedUrl.pathname + parsedUrl.search,
        timeout: timeoutMs,
      },
      (res) => {
        // Consume response body to free socket
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("HTTP request timed out"));
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Individual health checks
// ---------------------------------------------------------------------------

/**
 * Ping Redis and measure round-trip latency.
 */
export function checkRedis(redis: RedisClient, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ComponentHealth> {
  return withTimeout("redis", async () => {
    const start = Date.now();
    const pong = await redis.ping();
    const latencyMs = Date.now() - start;

    return {
      name: "redis",
      status: pong === "PONG" ? "healthy" : "unhealthy",
      latencyMs,
      details: pong === "PONG" ? undefined : `Unexpected ping response: ${pong}`,
      lastChecked: new Date(),
    };
  }, timeoutMs);
}

/**
 * Execute a simple SQL query against PostgreSQL and measure latency.
 */
export function checkPostgres(db: PostgresDb, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ComponentHealth> {
  return withTimeout("postgres", async () => {
    const start = Date.now();
    // Drizzle's execute is the most reliable way to run raw SQL
    await db.execute(/* sql */ "SELECT 1");
    const latencyMs = Date.now() - start;

    return {
      name: "postgres",
      status: "healthy",
      latencyMs,
      lastChecked: new Date(),
    };
  }, timeoutMs);
}

/**
 * Check if the OntologyStore has been synced recently (within the last 2 minutes).
 */
export function checkOntologyStore(store: OntologyStore, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ComponentHealth> {
  return withTimeout("ontology-store", async () => {
    const stats = store.getStats();
    const now = Date.now();
    const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

    if (!stats.lastSyncedAt) {
      return {
        name: "ontology-store",
        status: "unhealthy",
        details: "Store has never been synced",
        lastChecked: new Date(),
      };
    }

    const ageMs = now - stats.lastSyncedAt.getTime();

    if (ageMs > STALE_THRESHOLD_MS) {
      return {
        name: "ontology-store",
        status: "unhealthy",
        details: `Last sync was ${Math.round(ageMs / 1000)}s ago (threshold: 120s)`,
        lastChecked: new Date(),
      };
    }

    return {
      name: "ontology-store",
      status: "healthy",
      details: `${stats.orders} orders, ${stats.drivers} drivers, synced ${Math.round(ageMs / 1000)}s ago`,
      lastChecked: new Date(),
    };
  }, timeoutMs);
}

/**
 * Check LLM service health by hitting its /health endpoint.
 */
export function checkLlm(baseUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ComponentHealth> {
  return withTimeout("llm", async () => {
    const start = Date.now();
    const url = baseUrl.replace(/\/+$/, "") + "/health";
    const statusCode = await httpGet(url, timeoutMs);
    const latencyMs = Date.now() - start;

    const isHealthy = statusCode >= 200 && statusCode < 300;

    return {
      name: "llm",
      status: isHealthy ? "healthy" : "degraded",
      latencyMs,
      details: isHealthy ? undefined : `LLM health endpoint returned ${statusCode}`,
      lastChecked: new Date(),
    };
  }, timeoutMs);
}

/**
 * Check Chrome browser health by hitting CDP's /json/version endpoint.
 */
export function checkChrome(cdpUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ComponentHealth> {
  return withTimeout("chrome", async () => {
    // CDP URL is usually ws://host:port — convert to http for the JSON endpoint
    const httpUrl = cdpUrl.replace(/^ws/, "http").replace(/\/$/, "") + "/json/version";
    const start = Date.now();
    const statusCode = await httpGet(httpUrl, timeoutMs);
    const latencyMs = Date.now() - start;

    const isHealthy = statusCode >= 200 && statusCode < 300;

    return {
      name: "chrome",
      status: isHealthy ? "healthy" : "unhealthy",
      latencyMs,
      details: isHealthy ? undefined : `Chrome CDP returned ${statusCode}`,
      lastChecked: new Date(),
    };
  }, timeoutMs);
}

// ---------------------------------------------------------------------------
// Temporal worker status (simple flag, set by the worker boot code)
// ---------------------------------------------------------------------------

let _temporalWorkerRunning = false;

/** Called by the worker bootstrap to mark the Temporal worker as running. */
export function setTemporalWorkerRunning(running: boolean): void {
  _temporalWorkerRunning = running;
}

/**
 * Check whether the Temporal worker is running.
 */
export function checkTemporalWorker(): Promise<ComponentHealth> {
  return withTimeout("temporal-worker", async () => ({
    name: "temporal-worker",
    status: _temporalWorkerRunning ? "healthy" : "unhealthy",
    details: _temporalWorkerRunning ? "Worker is running" : "Worker is not running",
    lastChecked: new Date(),
  }));
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/** Components whose failure marks the whole system as unhealthy. */
const CRITICAL_COMPONENTS = new Set(["redis", "postgres", "temporal-worker"]);

/**
 * Aggregate individual component health into an overall SystemHealth.
 *
 * - unhealthy if any critical component is unhealthy
 * - degraded if any component is degraded or a non-critical component is unhealthy
 * - healthy otherwise
 */
export function aggregateHealth(components: ComponentHealth[]): SystemHealth {
  let hasCriticalFailure = false;
  let hasDegradation = false;

  for (const c of components) {
    if (c.status === "unhealthy" && CRITICAL_COMPONENTS.has(c.name)) {
      hasCriticalFailure = true;
      break; // can't get worse
    }
    if (c.status === "unhealthy" || c.status === "degraded") {
      hasDegradation = true;
    }
  }

  const overall: HealthStatus = hasCriticalFailure
    ? "unhealthy"
    : hasDegradation
      ? "degraded"
      : "healthy";

  return {
    status: overall,
    uptime: Math.floor((Date.now() - processStartTime) / 1000),
    components,
    timestamp: new Date(),
  };
}
