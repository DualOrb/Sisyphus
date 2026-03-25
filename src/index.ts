import { env } from "./config/index.js";
import { logger } from "./lib/index.js";
import { Connection, Client } from "@temporalio/client";
import { startWorker, shutdownSystem } from "./shift/worker.js";
import { createShiftSchedule } from "./shift/scheduler.js";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  logger.info(
    {
      model: env.LLM_MODEL,
      timezone: env.BUSINESS_TIMEZONE,
      temporalAddress: env.TEMPORAL_ADDRESS,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      businessHours: `${env.BUSINESS_HOURS_START}-${env.BUSINESS_HOURS_END}`,
      adapter: env.DISPATCH_ADAPTER,
      mode: env.OPERATING_MODE,
    },
    "Sisyphus starting up",
  );

  // ---- 1. Start the Temporal worker (handles its own init) ----
  // The worker initializes all connections, services, health server,
  // and activity functions before it starts polling for tasks.
  logger.info("Starting Temporal worker (includes full system initialization)...");
  const worker = await startWorker();
  logger.info("Temporal worker running — system fully initialized");

  // ---- 2. Create/update the shift schedule ----
  logger.info("Connecting to Temporal server for scheduling...");
  const connection = await Connection.connect({
    address: env.TEMPORAL_ADDRESS,
  });
  const client = new Client({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
  });

  await createShiftSchedule(client);
  logger.info(
    {
      schedule: "sisyphus-daily-shift",
      startTime: env.BUSINESS_HOURS_START,
      endTime: env.BUSINESS_HOURS_END,
      timezone: env.BUSINESS_TIMEZONE,
    },
    "Sisyphus ready — shift schedule active",
  );

  // ---- 3. Graceful shutdown handlers ----
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Received shutdown signal, stopping gracefully...");

    try {
      worker.shutdown();
      logger.info("Temporal worker shutdown initiated");
    } catch (err) {
      logger.error({ err }, "Error during worker shutdown");
    }

    // Shut down all Sisyphus connections and services
    try {
      await shutdownSystem();
      logger.info("Sisyphus system shutdown complete");
    } catch (err) {
      logger.error({ err }, "Error during system shutdown");
    }

    // Safety net: force exit after 30s if shutdown hasn't completed
    setTimeout(() => {
      logger.warn("Shutdown timeout reached, forcing exit");
      process.exit(1);
    }, 30_000);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // ---- 4. Keep the process alive ----
  // The Temporal worker is polling for tasks in the background.
  // This process stays alive until a shutdown signal is received.
  logger.info("Process running — Temporal worker polling for shift tasks. Press Ctrl+C to stop.");
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

main().catch((err) => {
  logger.fatal({ err }, "Sisyphus failed to start");
  process.exit(1);
});
