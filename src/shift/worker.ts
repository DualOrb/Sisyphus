/**
 * Temporal worker setup for the Sisyphus shift lifecycle.
 *
 * Creates a Temporal Worker that registers activities and workflows,
 * then connects to the Temporal server. The worker runs in-process
 * alongside the main Sisyphus application (no separate container needed).
 *
 * On startup, the worker:
 *  1. Initializes the full Sisyphus system (connections + services)
 *  2. Creates activity functions from the initialized infrastructure
 *  3. Starts the health server with live connection health checks
 *  4. Registers activities and workflows with the Temporal worker
 */

import { Worker, NativeConnection } from "@temporalio/worker";
import { env } from "../config/env.js";
import { createChildLogger } from "../lib/logger.js";
import { initializeSisyphus, type SisyphusSystem } from "../init/index.js";
import { shutdownSisyphus } from "../init/shutdown.js";
import { createActivities } from "./activities.js";
import { startHealthServer } from "../health/server.js";
import {
  checkRedis,
  checkPostgres,
  checkOntologyStore,
  checkChrome,
  checkTemporalWorker,
  setTemporalWorkerRunning,
  aggregateHealth,
} from "../health/checks.js";

import type http from "node:http";

const log = createChildLogger("shift:worker");

// ---------------------------------------------------------------------------
// Module-level references for shutdown coordination
// ---------------------------------------------------------------------------

let system: SisyphusSystem | null = null;
let healthServer: http.Server | null = null;

// ---------------------------------------------------------------------------
// Worker startup
// ---------------------------------------------------------------------------

/**
 * Create and start the Temporal worker with the full Sisyphus system.
 *
 * The worker:
 * - Initializes all connections and services
 * - Creates activity functions from the initialized infrastructure
 * - Connects to the Temporal server at TEMPORAL_ADDRESS
 * - Starts the health server on port 3000
 * - Listens on the TEMPORAL_TASK_QUEUE for workflow and activity tasks
 * - Registers all shift activities (startBrowser, syncOntology, etc.)
 * - Points to the compiled workflows file for workflow definitions
 *
 * @returns The running Worker instance (call worker.shutdown() to stop)
 */
export async function startWorker(): Promise<Worker> {
  const { TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE, TEMPORAL_TASK_QUEUE } = env;

  log.info(
    { address: TEMPORAL_ADDRESS, namespace: TEMPORAL_NAMESPACE, taskQueue: TEMPORAL_TASK_QUEUE },
    "Starting Temporal worker — initializing Sisyphus system",
  );

  // ---- 1. Initialize the full Sisyphus system ------------------------------
  system = await initializeSisyphus();
  log.info("Sisyphus system initialized");

  // ---- 2. Create activity functions from initialized infrastructure --------
  const activities = createActivities(system.connections, system.services);
  log.info("Activity functions created from initialized infrastructure");

  // ---- 3. Start the health server ------------------------------------------
  healthServer = startHealthServer(
    3000,
    async () => {
      const components = await Promise.all([
        checkRedis(system!.connections.redis),
        checkPostgres(system!.connections.db),
        checkOntologyStore(system!.services.store),
        checkChrome(env.CHROME_CDP_URL),
        checkTemporalWorker(),
      ]);
      return aggregateHealth(components);
    },
    {
      getShiftStats: activities.getShiftStats,
      getOntologyStats: () => system!.services.store.getStats(),
      getEventQueueSize: () => system!.services.eventQueue.size,
    },
  );
  log.info("Health server started on port 3000");

  // ---- 4. Establish gRPC connection to the Temporal server -----------------
  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });
  log.info({ address: TEMPORAL_ADDRESS }, "Connected to Temporal server");

  // ---- 5. Create and start the Temporal worker -----------------------------
  const workflowsPath = new URL("./workflows.js", import.meta.url).pathname;

  const worker = await Worker.create({
    connection,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: TEMPORAL_TASK_QUEUE,
    workflowsPath,
    activities,
  });

  setTemporalWorkerRunning(true);

  log.info(
    { taskQueue: TEMPORAL_TASK_QUEUE, workflowsPath },
    "Temporal worker created, starting to poll for tasks",
  );

  // worker.run() returns a Promise that resolves when the worker is shut down.
  // We start it but don't await it here — the caller decides how to manage
  // the worker lifecycle.
  const runPromise = worker.run();

  // Log when the worker stops (either gracefully or due to error)
  runPromise.then(
    () => {
      setTemporalWorkerRunning(false);
      log.info("Temporal worker stopped gracefully");
    },
    (err) => {
      setTemporalWorkerRunning(false);
      log.error({ err }, "Temporal worker stopped with error");
    },
  );

  return worker;
}

/**
 * Get the current Sisyphus system (connections + services).
 *
 * Returns null if the system has not been initialized yet.
 * Useful for shutdown coordination from the main entry point.
 */
export function getSystem(): SisyphusSystem | null {
  return system;
}

/**
 * Get the health server instance.
 *
 * Returns null if the health server has not been started yet.
 */
export function getHealthServer(): http.Server | null {
  return healthServer;
}

/**
 * Perform a full graceful shutdown of the Sisyphus system.
 *
 * Called from the main entry point's shutdown handler.
 */
export async function shutdownSystem(): Promise<void> {
  if (system) {
    await shutdownSisyphus(system.connections, system.services, healthServer ?? undefined);
    system = null;
    healthServer = null;
  }
}
