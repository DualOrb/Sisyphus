/**
 * Temporal workflow definitions for the Sisyphus shift lifecycle.
 *
 * IMPORTANT: Workflow files run in the Temporal sandbox and must be
 * deterministic. They CANNOT import non-deterministic code. All side effects
 * happen in activities, which are called via proxyActivities().
 *
 * Only imports allowed:
 *   - @temporalio/workflow
 *   - Other workflow files
 *   - Type-only imports (import type ...)
 */

import {
  proxyActivities,
  sleep,
  continueAsNew,
  log as wfLog,
  ApplicationFailure,
} from "@temporalio/workflow";

import type { SisyphusActivities, ShiftStats } from "./activities.js";

// ---------------------------------------------------------------------------
// Activity proxies with retry/timeout configuration
// ---------------------------------------------------------------------------

/** Default activities — moderate timeout, 3 retries. */
const acts = proxyActivities<SisyphusActivities>({
  startToCloseTimeout: "60s",
  retry: {
    maximumAttempts: 3,
    initialInterval: "2s",
    backoffCoefficient: 2,
    maximumInterval: "30s",
  },
});

/** Browser activities — longer timeout, more retries for flaky connections. */
const browserActs = proxyActivities<SisyphusActivities>({
  startToCloseTimeout: "120s",
  retry: {
    maximumAttempts: 5,
    initialInterval: "5s",
    backoffCoefficient: 2,
    maximumInterval: "60s",
  },
});

/** Dispatch cycle — longer timeout since LLM inference can be slow. */
const dispatchActs = proxyActivities<SisyphusActivities>({
  startToCloseTimeout: "300s",
  heartbeatTimeout: "60s",
  retry: {
    maximumAttempts: 2,
    initialInterval: "5s",
    backoffCoefficient: 2,
    maximumInterval: "30s",
  },
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of dispatch cycles before we continueAsNew to avoid
 * hitting Temporal's event history size limit (~50K events).
 * Each cycle generates roughly 5-10 events, so 1000 cycles is safe.
 */
const MAX_CYCLES_BEFORE_CONTINUE_AS_NEW = 1000;

/** Interval between ontology syncs (milliseconds). */
const ONTOLOGY_SYNC_INTERVAL_MS = 30_000;

/** Interval between dispatch cycles (milliseconds). */
const DISPATCH_CYCLE_INTERVAL_MS = 10_000;

/** Grace period before business hours end to start shutdown (5 min). */
const SHUTDOWN_GRACE_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Main shift workflow
// ---------------------------------------------------------------------------

/**
 * The main Sisyphus shift workflow.
 *
 * Lifecycle:
 *   1. Start browser and authenticate with dispatch UI
 *   2. Initial ontology sync
 *   3. Main loop: while within business hours:
 *      a. Sync ontology (every ~30s)
 *      b. Run dispatch cycle (the LangGraph graph)
 *      c. Sleep between cycles
 *   4. Graceful shutdown: write shift summary, disconnect browser
 *
 * @param isResuming - If true, skip browser startup (already connected via continueAsNew)
 * @param cyclesSoFar - Number of cycles completed before this execution (for continueAsNew)
 */
export async function sisyphusShiftWorkflow(
  isResuming = false,
  cyclesSoFar = 0,
): Promise<void> {
  wfLog.info("Sisyphus shift workflow started", { isResuming, cyclesSoFar });

  // ------------------------------------------------------------------
  // Phase 1: Startup — browser + auth (skip if resuming after continueAsNew)
  // ------------------------------------------------------------------
  if (!isResuming) {
    wfLog.info("Phase 1: Starting browser and authenticating");

    try {
      const browserOk = await browserActs.startBrowser();
      if (!browserOk) {
        throw ApplicationFailure.nonRetryable("Failed to start browser");
      }
      wfLog.info("Browser connected");

      const authOk = await browserActs.authenticateDispatch();
      if (!authOk) {
        throw ApplicationFailure.nonRetryable("Failed to authenticate with dispatch UI");
      }
      wfLog.info("Authenticated with dispatch UI");
    } catch (err) {
      wfLog.error("Browser startup failed, attempting cleanup", {});

      try {
        await acts.disconnectBrowser();
      } catch {
        // Ignore cleanup errors
      }

      throw err;
    }

    // Phase 2: Initial ontology sync
    wfLog.info("Phase 2: Initial ontology sync");
    await acts.syncOntology();
    wfLog.info("Initial ontology sync complete");
  } else {
    wfLog.info("Resuming after continueAsNew — reconnecting browser");

    // After continueAsNew the worker process is the same, but we should
    // verify browser connectivity. If it fails, try a fresh connect.
    try {
      const browserOk = await browserActs.startBrowser();
      if (!browserOk) {
        throw new Error("Browser reconnection failed");
      }
      await browserActs.authenticateDispatch();
    } catch {
      wfLog.warn("Browser reconnection failed on resume, retrying from scratch", {});
      const browserOk = await browserActs.startBrowser();
      if (!browserOk) {
        throw ApplicationFailure.nonRetryable("Failed to reconnect browser after continueAsNew");
      }
      await browserActs.authenticateDispatch();
    }

    await acts.syncOntology();
  }

  // ------------------------------------------------------------------
  // Phase 3: Main dispatch loop
  // ------------------------------------------------------------------
  wfLog.info("Phase 3: Entering main dispatch loop");

  let cyclesThisExecution = 0;
  let lastOntologySyncMs = Date.now();
  let consecutiveErrors = 0;

  while (true) {
    // --- Check business hours ---
    const withinHours = await acts.isWithinBusinessHours();
    if (!withinHours) {
      wfLog.info("Outside business hours — beginning graceful shutdown");
      break;
    }

    // --- Ontology sync (every ONTOLOGY_SYNC_INTERVAL_MS) ---
    const msSinceLastSync = Date.now() - lastOntologySyncMs;
    if (msSinceLastSync >= ONTOLOGY_SYNC_INTERVAL_MS) {
      try {
        await acts.syncOntology();
        lastOntologySyncMs = Date.now();
        consecutiveErrors = 0;
      } catch (err) {
        wfLog.warn("Ontology sync failed, will retry next cycle", {});
        consecutiveErrors++;
      }
    }

    // --- Run dispatch cycle ---
    try {
      await dispatchActs.runDispatchCycle();
      cyclesThisExecution++;
      consecutiveErrors = 0;
    } catch (err) {
      wfLog.error("Dispatch cycle failed", {});
      consecutiveErrors++;

      // If too many consecutive errors, attempt browser reconnection
      if (consecutiveErrors >= 5) {
        wfLog.warn("Too many consecutive errors — attempting browser reconnection", {});
        try {
          await acts.disconnectBrowser();
          const browserOk = await browserActs.startBrowser();
          if (browserOk) {
            await browserActs.authenticateDispatch();
            consecutiveErrors = 0;
            wfLog.info("Browser reconnected successfully");
          }
        } catch {
          wfLog.error("Browser reconnection failed", {});
        }
      }

      // If still failing after reconnection attempt, bail
      if (consecutiveErrors >= 10) {
        wfLog.error("Too many consecutive errors — aborting shift", {});
        break;
      }
    }

    // --- Check if we need to continueAsNew (event history limit) ---
    const totalCycles = cyclesSoFar + cyclesThisExecution;
    if (cyclesThisExecution >= MAX_CYCLES_BEFORE_CONTINUE_AS_NEW) {
      wfLog.info("Approaching event history limit — continuing as new workflow", {
        totalCycles,
      });
      await continueAsNew<typeof sisyphusShiftWorkflow>(true, totalCycles);
      // continueAsNew never returns — execution continues in a fresh workflow
    }

    // --- Sleep between cycles ---
    await sleep(DISPATCH_CYCLE_INTERVAL_MS);
  }

  // ------------------------------------------------------------------
  // Phase 4: Graceful shutdown
  // ------------------------------------------------------------------
  wfLog.info("Phase 4: Graceful shutdown");

  try {
    const stats = await acts.getShiftStats();
    await acts.writeShiftSummary(stats);
    wfLog.info("Shift summary written", {
      totalCycles: cyclesSoFar + cyclesThisExecution,
    });
  } catch (err) {
    wfLog.error("Failed to write shift summary", {});
  }

  try {
    await acts.disconnectBrowser();
    wfLog.info("Browser disconnected");
  } catch (err) {
    wfLog.warn("Error disconnecting browser during shutdown", {});
  }

  wfLog.info("Sisyphus shift workflow completed", {
    totalCycles: cyclesSoFar + cyclesThisExecution,
  });
}
