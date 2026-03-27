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
import { existsSync, readFileSync } from "node:fs";
import { resolve, extname, join } from "node:path";
import { createChildLogger } from "../lib/logger.js";
import type { SystemHealth } from "./checks.js";
import type { ShiftStats } from "../shift/activities.js";
import type { OntologyStats } from "../ontology/state/store.js";
import type { ApiRouter } from "../api/router.js";

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
// Static file serving for dashboard SPA
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** Try to find dashboard/dist relative to the project root. */
function findDashboardDir(): string | null {
  // Walk up from this file to find dashboard/dist
  const candidates = [
    resolve(new URL(".", import.meta.url).pathname, "../../dashboard/dist"),
    resolve(process.cwd(), "dashboard/dist"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return null;
}

let _dashboardDir: string | null | undefined;

function serveDashboardFile(url: string, res: http.ServerResponse): boolean {
  if (_dashboardDir === undefined) {
    _dashboardDir = findDashboardDir();
    if (_dashboardDir) {
      log.info({ dir: _dashboardDir }, "Dashboard static files found");
    }
  }
  if (!_dashboardDir) return false;

  const pathname = new URL(url, "http://localhost").pathname;

  // Try exact file first
  const filePath = join(_dashboardDir, pathname);
  if (existsSync(filePath) && !filePath.endsWith("/")) {
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(readFileSync(filePath));
    return true;
  }

  // SPA fallback — serve index.html for non-file paths
  const indexPath = join(_dashboardDir, "index.html");
  if (existsSync(indexPath)) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(readFileSync(indexPath));
    return true;
  }

  return false;
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
 * @param dashboardRouter - optional API router for dashboard endpoints
 * @returns the http.Server instance (caller can close it on shutdown)
 */
export function startHealthServer(
  port: number,
  getHealth: () => Promise<SystemHealth>,
  providers: StatusProviders = {},
  dashboardRouter?: ApiRouter,
): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    log.debug({ method, url }, "Health server request");

    // Handle CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    // Only handle GET
    if (method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    // Try dashboard routes first (if registered)
    if (dashboardRouter) {
      const match = dashboardRouter.match(url);
      if (match) {
        try {
          await match.handler(req, res, match.ctx);
        } catch (err) {
          log.error({ err, url }, "Dashboard route error");
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        }
        return;
      }
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

        // ----- Static files / SPA fallback -----
        default: {
          const served = serveDashboardFile(url, res);
          if (!served) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
          }
          log.debug({ status: served ? 200 : 404, url }, "Health server response");
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
