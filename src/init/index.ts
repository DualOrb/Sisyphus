/**
 * Sisyphus initialization barrel — single entry point to boot the entire system.
 *
 * Usage:
 *   const { connections, services } = await initializeSisyphus();
 */

import { env } from "../config/env.js";
import { createChildLogger } from "../lib/logger.js";
import { initializeConnections, type SisyphusConnections } from "./connections.js";
import { initializeServices, type SisyphusServices } from "./services.js";

export type { SisyphusConnections } from "./connections.js";
export type { SisyphusServices } from "./services.js";
export { initializeConnections } from "./connections.js";
export { initializeServices } from "./services.js";
export { shutdownSisyphus } from "./shutdown.js";

const log = createChildLogger("init");

// ---------------------------------------------------------------------------
// Main init function
// ---------------------------------------------------------------------------

export interface SisyphusSystem {
  connections: SisyphusConnections;
  services: SisyphusServices;
}

/**
 * Boot the entire Sisyphus system.
 *
 * 1. Initializes all external connections (Redis, PostgreSQL, browser, adapter)
 * 2. Initializes all services (ontology, graph, events, WebSocket)
 *
 * @returns Object containing all connections and services.
 * @throws If a critical connection (Redis, PostgreSQL) fails.
 */
export async function initializeSisyphus(): Promise<SisyphusSystem> {
  log.info("Booting Sisyphus system...");
  const startMs = Date.now();

  const connections = await initializeConnections(env);
  const services = await initializeServices(connections, env);

  const durationMs = Date.now() - startMs;
  log.info({ durationMs }, `Sisyphus system initialized in ${durationMs}ms`);

  return { connections, services };
}
