/**
 * Temporal worker setup for the Sisyphus shift lifecycle.
 *
 * Creates a Temporal Worker that registers activities and workflows,
 * then connects to the Temporal server. The worker runs in-process
 * alongside the main Sisyphus application (no separate container needed).
 */

import { Worker, NativeConnection } from "@temporalio/worker";
import { env } from "../config/env.js";
import { createChildLogger } from "../lib/logger.js";

import * as activities from "./activities.js";

const log = createChildLogger("shift:worker");

/**
 * Create and start the Temporal worker.
 *
 * The worker:
 * - Connects to the Temporal server at TEMPORAL_ADDRESS
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
    "Starting Temporal worker",
  );

  // Establish gRPC connection to the Temporal server
  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });

  log.info({ address: TEMPORAL_ADDRESS }, "Connected to Temporal server");

  // Resolve the path to the compiled workflows file.
  // In ESM, import.meta.url gives us the current file's URL. The compiled
  // workflows.js lives next to this file in the output directory.
  const workflowsPath = new URL("./workflows.js", import.meta.url).pathname;

  const worker = await Worker.create({
    connection,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: TEMPORAL_TASK_QUEUE,
    workflowsPath,
    activities,
  });

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
    () => log.info("Temporal worker stopped gracefully"),
    (err) => log.error({ err }, "Temporal worker stopped with error"),
  );

  return worker;
}
