/**
 * Lightweight HTTP health endpoint for Docker / Kubernetes probes.
 *
 * Uses Node's built-in `http` module — no Express needed.
 *
 * Endpoints:
 *   GET /health       — full system health (200 or 503)
 *   GET /health/ready — readiness probe (200 or 503)
 *   GET /health/live  — liveness probe (always 200)
 *   GET /status       — extended operational status
 */

import http from "node:http";
import { createChildLogger } from "../lib/logger.js";
import type { SystemHealth } from "./checks.js";
import type { ShiftStats } from "../shift/activities.js";
import type { OntologyStats } from "../ontology/state/store.js";

const log = createChildLogger("health:server");

// ---------------------------------------------------------------------------
// Extended status payload
// ---------------------------------------------------------------------------

export interface ExtendedStatus {
  health: SystemHealth;
  shift?: ShiftStats;
  ontology?: OntologyStats;
  eventQueueSize?: number;
  uptime: number;
}

export interface StatusProviders {
  getShiftStats?: () => Promise<ShiftStats>;
  getOntologyStats?: () => OntologyStats;
  getEventQueueSize?: () => number;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/**
 * Start a minimal HTTP health server.
 *
 * @param port - TCP port to listen on (default 3000)
 * @param getHealth - async function that returns current SystemHealth
 * @param providers - optional callbacks for extended status data
 * @returns the http.Server instance (caller can close it on shutdown)
 */
export function startHealthServer(
  port: number,
  getHealth: () => Promise<SystemHealth>,
  providers: StatusProviders = {},
): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    log.debug({ method, url }, "Health server request");

    // Only handle GET
    if (method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    try {
      switch (url) {
        // ----- Liveness probe (always 200) -----
        case "/health/live": {
          const body = { status: "alive", timestamp: new Date().toISOString() };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(body));
          log.debug({ status: 200, url }, "Health server response");
          break;
        }

        // ----- Readiness probe -----
        case "/health/ready": {
          const health = await getHealth();
          const ready = health.status !== "unhealthy";
          const statusCode = ready ? 200 : 503;
          res.writeHead(statusCode, { "Content-Type": "application/json" });
          res.end(JSON.stringify(health));
          log.debug({ status: statusCode, url, healthStatus: health.status }, "Health server response");
          break;
        }

        // ----- Full health check -----
        case "/health": {
          const health = await getHealth();
          const statusCode = health.status === "unhealthy" ? 503 : 200;
          res.writeHead(statusCode, { "Content-Type": "application/json" });
          res.end(JSON.stringify(health));
          log.debug({ status: statusCode, url, healthStatus: health.status }, "Health server response");
          break;
        }

        // ----- Extended status -----
        case "/status": {
          const health = await getHealth();
          const extended: ExtendedStatus = {
            health,
            uptime: health.uptime,
          };

          if (providers.getShiftStats) {
            extended.shift = await providers.getShiftStats();
          }
          if (providers.getOntologyStats) {
            extended.ontology = providers.getOntologyStats();
          }
          if (providers.getEventQueueSize) {
            extended.eventQueueSize = providers.getEventQueueSize();
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(extended));
          log.debug({ status: 200, url }, "Health server response");
          break;
        }

        // ----- 404 -----
        default: {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
          log.debug({ status: 404, url }, "Health server response");
          break;
        }
      }
    } catch (err) {
      log.error({ err, url }, "Health server error");
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });

  server.listen(port, () => {
    log.info({ port }, "Health server listening");
  });

  return server;
}
