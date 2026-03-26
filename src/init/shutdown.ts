/**
 * Graceful shutdown for Sisyphus.
 *
 * Tears down all connections and services in reverse order of initialization.
 * Each step has independent error handling so one failure does not prevent
 * the rest of the cleanup from running.
 *
 * Also generates a shift report from accumulated shadow metrics and audit
 * records (same data that shadow-live.ts writes on SIGINT).
 */

import type { SisyphusConnections } from "./connections.js";
import type { SisyphusServices } from "./services.js";
import { disconnectBrowser } from "../execution/browser/connection.js";
import { createChildLogger } from "../lib/logger.js";

import type http from "node:http";

const log = createChildLogger("init:shutdown");

/**
 * Shut down all Sisyphus connections and services.
 *
 * @param connections - Active connections to tear down
 * @param services - Active services to stop
 * @param healthServer - Optional HTTP health server to close (deprecated — use services.healthServer)
 */
export async function shutdownSisyphus(
  connections: SisyphusConnections,
  services: SisyphusServices,
  healthServer?: http.Server,
): Promise<void> {
  log.info("Starting Sisyphus graceful shutdown...");

  // ---- 0. Generate shift report (non-fatal) --------------------------------
  try {
    const metrics = services.shadowMetrics.getSummary();
    const proposals = services.shadowExecutor.getProposals();
    const auditRecords = services.auditRecords;

    log.info(
      {
        shiftId: services.shiftId,
        totalProposals: metrics.totalProposals,
        totalAuditRecords: auditRecords.length,
        byAction: metrics.byAction,
        byTier: metrics.byTier,
        byValidation: metrics.byValidation,
        byAgent: metrics.byAgent,
        byMethod: metrics.byMethod,
      },
      "Shift report — shadow metrics summary",
    );

    if (proposals.length > 0) {
      log.info({ count: proposals.length }, "Shift report — all proposals");
      for (const p of proposals) {
        log.info(
          {
            timestamp: p.timestamp.toISOString(),
            actionName: p.actionName,
            tier: p.tier,
            wouldExecuteVia: p.wouldExecuteVia,
            reasoning: p.reasoning ?? "n/a",
          },
          "Shift proposal",
        );
      }
    }
  } catch (err) {
    log.error({ err }, "Error generating shift report");
  }

  // ---- 1. Stop syncer polling ----------------------------------------------
  try {
    log.info("Stopping ontology syncer polling");
    services.syncer.stopPolling();
    log.info("Ontology syncer stopped");
  } catch (err) {
    log.error({ err }, "Error stopping ontology syncer");
  }

  // ---- 2. Disconnect WebSocket ---------------------------------------------
  try {
    if (connections.wsClient) {
      log.info("Disconnecting dispatch WebSocket");
      connections.wsClient.disconnect();
      log.info("Dispatch WebSocket disconnected");
    }
  } catch (err) {
    log.error({ err }, "Error disconnecting WebSocket");
  }

  // ---- 3. Disconnect browser -----------------------------------------------
  try {
    if (connections.browser) {
      log.info("Disconnecting Chrome browser");
      await disconnectBrowser(connections.browser);
      connections.browser = null;
      connections.page = null;
      log.info("Chrome browser disconnected");
    }
  } catch (err) {
    log.error({ err }, "Error disconnecting browser");
  }

  // ---- 4. Close Redis ------------------------------------------------------
  try {
    log.info("Closing Redis connection");
    connections.redis.disconnect();
    log.info("Redis connection closed");
  } catch (err) {
    log.error({ err }, "Error closing Redis connection");
  }

  // ---- 5. Close PostgreSQL pool -------------------------------------------
  // Drizzle wraps a pg.Pool — to close it we need to reach the underlying pool.
  // The pool is internal to drizzle, so the safest approach is to let it
  // drain on process exit. We log the intent regardless.
  try {
    log.info("PostgreSQL pool will drain on process exit");
  } catch (err) {
    log.error({ err }, "Error with PostgreSQL cleanup");
  }

  // ---- 6. Stop health server -----------------------------------------------
  // Support both the legacy `healthServer` parameter and the services-managed one.
  const server = healthServer ?? services.healthServer;
  try {
    if (server) {
      log.info("Stopping health server");
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      log.info("Health server stopped");
    }
  } catch (err) {
    log.error({ err }, "Error stopping health server");
  }

  log.info("Sisyphus graceful shutdown complete");
}
