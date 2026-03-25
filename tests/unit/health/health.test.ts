/**
 * Unit tests for the Sisyphus health check system.
 *
 * Tests cover:
 * - OntologyStore health check (recently synced vs stale)
 * - aggregateHealth logic (healthy, degraded, unhealthy)
 * - Health HTTP server endpoints
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import {
  checkOntologyStore,
  checkTemporalWorker,
  setTemporalWorkerRunning,
  aggregateHealth,
  type ComponentHealth,
  type HealthStatus,
} from "@/health/checks";
import { startHealthServer, type StatusProviders } from "@/health/server";
import { OntologyStore } from "@ontology/state/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComponent(name: string, status: HealthStatus): ComponentHealth {
  return { name, status, lastChecked: new Date() };
}

/** Simple HTTP GET helper that returns { statusCode, body }. */
function httpGet(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
    }).on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// checkOntologyStore
// ---------------------------------------------------------------------------

describe("checkOntologyStore", () => {
  let store: OntologyStore;

  beforeEach(() => {
    store = new OntologyStore();
  });

  it("returns healthy when the store was recently synced", async () => {
    store.markSynced(); // sets lastSyncedAt to now
    const result = await checkOntologyStore(store);

    expect(result.name).toBe("ontology-store");
    expect(result.status).toBe("healthy");
  });

  it("returns unhealthy when the store has never been synced", async () => {
    // Never call markSynced — lastSyncedAt remains null
    const result = await checkOntologyStore(store);

    expect(result.name).toBe("ontology-store");
    expect(result.status).toBe("unhealthy");
    expect(result.details).toContain("never been synced");
  });

  it("returns unhealthy when the last sync is older than 2 minutes", async () => {
    // Manually set a stale sync time
    store.markSynced();
    // Hack: override the private field via the public getter's backing store
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
    Object.defineProperty(store, "lastSyncedAt", { get: () => threeMinutesAgo });
    // Re-stub getStats to reflect the stale time
    const originalGetStats = store.getStats.bind(store);
    store.getStats = () => ({ ...originalGetStats(), lastSyncedAt: threeMinutesAgo });

    const result = await checkOntologyStore(store);

    expect(result.name).toBe("ontology-store");
    expect(result.status).toBe("unhealthy");
    expect(result.details).toContain("threshold");
  });
});

// ---------------------------------------------------------------------------
// checkTemporalWorker
// ---------------------------------------------------------------------------

describe("checkTemporalWorker", () => {
  it("returns unhealthy when worker flag is false", async () => {
    setTemporalWorkerRunning(false);
    const result = await checkTemporalWorker();

    expect(result.status).toBe("unhealthy");
  });

  it("returns healthy when worker flag is true", async () => {
    setTemporalWorkerRunning(true);
    const result = await checkTemporalWorker();

    expect(result.status).toBe("healthy");

    // Clean up
    setTemporalWorkerRunning(false);
  });
});

// ---------------------------------------------------------------------------
// aggregateHealth
// ---------------------------------------------------------------------------

describe("aggregateHealth", () => {
  it("returns healthy when all components are healthy", () => {
    const components = [
      makeComponent("redis", "healthy"),
      makeComponent("postgres", "healthy"),
      makeComponent("temporal-worker", "healthy"),
      makeComponent("llm", "healthy"),
      makeComponent("chrome", "healthy"),
      makeComponent("ontology-store", "healthy"),
    ];

    const result = aggregateHealth(components);
    expect(result.status).toBe("healthy");
    expect(result.components).toHaveLength(6);
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });

  it("returns degraded when a non-critical component is degraded", () => {
    const components = [
      makeComponent("redis", "healthy"),
      makeComponent("postgres", "healthy"),
      makeComponent("temporal-worker", "healthy"),
      makeComponent("llm", "degraded"),
      makeComponent("chrome", "healthy"),
    ];

    const result = aggregateHealth(components);
    expect(result.status).toBe("degraded");
  });

  it("returns degraded when a non-critical component is unhealthy", () => {
    const components = [
      makeComponent("redis", "healthy"),
      makeComponent("postgres", "healthy"),
      makeComponent("temporal-worker", "healthy"),
      makeComponent("llm", "unhealthy"),
      makeComponent("chrome", "healthy"),
    ];

    const result = aggregateHealth(components);
    expect(result.status).toBe("degraded");
  });

  it("returns unhealthy when a critical component (redis) is unhealthy", () => {
    const components = [
      makeComponent("redis", "unhealthy"),
      makeComponent("postgres", "healthy"),
      makeComponent("temporal-worker", "healthy"),
      makeComponent("llm", "healthy"),
    ];

    const result = aggregateHealth(components);
    expect(result.status).toBe("unhealthy");
  });

  it("returns unhealthy when a critical component (postgres) is unhealthy", () => {
    const components = [
      makeComponent("redis", "healthy"),
      makeComponent("postgres", "unhealthy"),
      makeComponent("temporal-worker", "healthy"),
    ];

    const result = aggregateHealth(components);
    expect(result.status).toBe("unhealthy");
  });

  it("returns unhealthy when a critical component (temporal-worker) is unhealthy", () => {
    const components = [
      makeComponent("redis", "healthy"),
      makeComponent("postgres", "healthy"),
      makeComponent("temporal-worker", "unhealthy"),
    ];

    const result = aggregateHealth(components);
    expect(result.status).toBe("unhealthy");
  });

  it("returns healthy for empty component list", () => {
    const result = aggregateHealth([]);
    expect(result.status).toBe("healthy");
  });
});

// ---------------------------------------------------------------------------
// Health HTTP server
// ---------------------------------------------------------------------------

describe("Health HTTP server", () => {
  let server: http.Server;
  let port: number;

  const healthySystem = async () =>
    aggregateHealth([
      makeComponent("redis", "healthy"),
      makeComponent("postgres", "healthy"),
    ]);

  const unhealthySystem = async () =>
    aggregateHealth([
      makeComponent("redis", "unhealthy"),
      makeComponent("postgres", "healthy"),
    ]);

  afterEach(() => {
    if (server) {
      server.close();
    }
  });

  /** Start server on a random port and return the port. */
  function startOnRandomPort(
    getHealth: () => ReturnType<typeof healthySystem>,
    providers?: StatusProviders,
  ): Promise<number> {
    return new Promise((resolve) => {
      server = startHealthServer(0, getHealth, providers);
      server.on("listening", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        }
      });
    });
  }

  it("GET /health/live always returns 200", async () => {
    port = await startOnRandomPort(healthySystem);
    const { statusCode, body } = await httpGet(`http://localhost:${port}/health/live`);

    expect(statusCode).toBe(200);
    const parsed = JSON.parse(body);
    expect(parsed.status).toBe("alive");
  });

  it("GET /health returns 200 when healthy", async () => {
    port = await startOnRandomPort(healthySystem);
    const { statusCode, body } = await httpGet(`http://localhost:${port}/health`);

    expect(statusCode).toBe(200);
    const parsed = JSON.parse(body);
    expect(parsed.status).toBe("healthy");
  });

  it("GET /health returns 503 when unhealthy", async () => {
    port = await startOnRandomPort(unhealthySystem);
    const { statusCode, body } = await httpGet(`http://localhost:${port}/health`);

    expect(statusCode).toBe(503);
    const parsed = JSON.parse(body);
    expect(parsed.status).toBe("unhealthy");
  });

  it("GET /health/ready returns 200 when healthy", async () => {
    port = await startOnRandomPort(healthySystem);
    const { statusCode } = await httpGet(`http://localhost:${port}/health/ready`);

    expect(statusCode).toBe(200);
  });

  it("GET /health/ready returns 503 when unhealthy", async () => {
    port = await startOnRandomPort(unhealthySystem);
    const { statusCode } = await httpGet(`http://localhost:${port}/health/ready`);

    expect(statusCode).toBe(503);
  });

  it("GET /status returns extended status with shift and ontology data", async () => {
    const providers: StatusProviders = {
      getShiftStats: async () => ({
        shiftStartedAt: "2026-03-25T09:00:00.000Z",
        dispatchCycles: 42,
        ontologySyncs: 21,
        actionsExecuted: 100,
        errorsEncountered: 2,
        browserReconnections: 0,
      }),
      getOntologyStats: () => ({
        orders: 15,
        drivers: 8,
        restaurants: 3,
        customers: 12,
        tickets: 4,
        markets: 2,
        conversations: 6,
        lastSyncedAt: new Date(),
      }),
      getEventQueueSize: () => 5,
    };

    port = await startOnRandomPort(healthySystem, providers);
    const { statusCode, body } = await httpGet(`http://localhost:${port}/status`);

    expect(statusCode).toBe(200);
    const parsed = JSON.parse(body);
    expect(parsed.shift.dispatchCycles).toBe(42);
    expect(parsed.ontology.orders).toBe(15);
    expect(parsed.eventQueueSize).toBe(5);
    expect(parsed.uptime).toBeGreaterThanOrEqual(0);
  });

  it("GET /unknown returns 404", async () => {
    port = await startOnRandomPort(healthySystem);
    const { statusCode } = await httpGet(`http://localhost:${port}/unknown`);

    expect(statusCode).toBe(404);
  });
});
