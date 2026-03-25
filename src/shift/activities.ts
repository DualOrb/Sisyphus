/**
 * Temporal activities for the Sisyphus shift lifecycle.
 *
 * Activities are where all side effects happen: browser automation, API calls,
 * database writes, etc. The Temporal workflow calls these via proxyActivities().
 *
 * The `createActivities()` factory closes over shared SisyphusConnections and
 * SisyphusServices that are initialized once at worker startup. No lazy init
 * or per-activity connection creation is needed.
 */

import { createChildLogger } from "../lib/logger.js";
import { env } from "../config/env.js";
import { connectBrowser, createDispatchPage, disconnectBrowser as doDisconnectBrowser } from "../execution/browser/connection.js";
import { writeShiftSummary as dbWriteShiftSummary } from "../memory/postgres/queries.js";

import type { SisyphusConnections } from "../init/connections.js";
import type { SisyphusServices } from "../init/services.js";

const log = createChildLogger("shift:activities");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShiftStats {
  shiftStartedAt: string;
  dispatchCycles: number;
  ontologySyncs: number;
  actionsExecuted: number;
  errorsEncountered: number;
  browserReconnections: number;
}

// ---------------------------------------------------------------------------
// Module-level state (lives in the worker process, shared across invocations)
// ---------------------------------------------------------------------------

let shiftStats: ShiftStats = {
  shiftStartedAt: new Date().toISOString(),
  dispatchCycles: 0,
  ontologySyncs: 0,
  actionsExecuted: 0,
  errorsEncountered: 0,
  browserReconnections: 0,
};

/** Reset stats at the beginning of a new shift. */
export function resetShiftStats(): void {
  shiftStats = {
    shiftStartedAt: new Date().toISOString(),
    dispatchCycles: 0,
    ontologySyncs: 0,
    actionsExecuted: 0,
    errorsEncountered: 0,
    browserReconnections: 0,
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Activity factory
// ---------------------------------------------------------------------------

/**
 * Create the Temporal activity functions with all infrastructure pre-wired.
 *
 * The returned object contains all activity functions that can be passed
 * directly to the Temporal worker. Connections and services are closed over
 * so each activity has immediate access to the initialized infrastructure.
 *
 * @param connections - Initialized connections (Redis, PG, browser, adapter)
 * @param services - Initialized services (store, syncer, graph, events)
 */
export function createActivities(connections: SisyphusConnections, services: SisyphusServices) {
  // -------------------------------------------------------------------------
  // startBrowser
  // -------------------------------------------------------------------------

  /**
   * Connect to the Chrome instance via CDP.
   *
   * Uses the already-established browser from init. If the browser was lost
   * (e.g. Chrome restarted), attempts to reconnect.
   */
  async function startBrowser(): Promise<boolean> {
    const cdpUrl = env.CHROME_CDP_URL;
    log.info({ cdpUrl }, "Connecting to Chrome via CDP");

    // If we already have a browser from init, just verify it is still alive
    if (connections.browser) {
      try {
        // Quick check: can we still talk to Chrome?
        const contexts = connections.browser.contexts();
        log.info(
          { contexts: contexts.length },
          "Chrome connection already established (from init)",
        );
        return true;
      } catch {
        log.warn("Existing Chrome connection is stale, reconnecting...");
        connections.browser = null;
        connections.page = null;
        shiftStats.browserReconnections++;
      }
    }

    // Reconnect
    try {
      connections.browser = await connectBrowser(cdpUrl);
      connections.page = await createDispatchPage(connections.browser);
      log.info("Chrome connection re-established");
      return true;
    } catch (err) {
      log.error({ err }, "Failed to connect to Chrome");
      connections.browser = null;
      connections.page = null;
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // authenticateDispatch
  // -------------------------------------------------------------------------

  /**
   * Authenticate Sisyphus with the dispatch UI.
   *
   * The initial login happens during init. This activity can re-authenticate
   * if the session has expired (e.g. mid-shift cookie expiry).
   */
  async function authenticateDispatch(): Promise<boolean> {
    const { DISPATCH_API_URL, DISPATCH_USERNAME } = env;
    log.info(
      { url: DISPATCH_API_URL, username: DISPATCH_USERNAME },
      "Authenticating with dispatch UI",
    );

    if (!connections.page) {
      log.error("No browser page available — call startBrowser() first");
      return false;
    }

    try {
      await connections.adapter.login(connections.page);
      connections.sessionCookie = await connections.adapter.getSessionCookies(connections.page);
      log.info("Dispatch authentication successful");
      return true;
    } catch (err) {
      log.error({ err }, "Dispatch authentication failed");
      shiftStats.errorsEncountered++;
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // syncOntology
  // -------------------------------------------------------------------------

  /**
   * Trigger one ontology sync cycle.
   *
   * Uses the pre-initialized syncer that is wired to the dispatch adapter.
   */
  async function syncOntology(): Promise<boolean> {
    log.info("Running ontology sync cycle");

    try {
      await services.syncer.sync();
      shiftStats.ontologySyncs++;
      const stats = services.store.getStats();
      log.info(
        { totalSyncs: shiftStats.ontologySyncs, ...stats },
        "Ontology sync completed",
      );
      return true;
    } catch (err) {
      log.error({ err }, "Ontology sync failed");
      shiftStats.errorsEncountered++;
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // runDispatchCycle
  // -------------------------------------------------------------------------

  /**
   * Run one iteration of the dispatch loop — invokes the LangGraph graph
   * through the DispatchCycle orchestrator.
   *
   * Uses the pre-initialized dispatch cycle that ties the event pipeline,
   * message listener, and graph together.
   */
  async function runDispatchCycle(): Promise<boolean> {
    log.info("Running dispatch cycle");

    try {
      const result = await services.dispatchCycle.run();

      shiftStats.dispatchCycles++;
      shiftStats.actionsExecuted += result.eventsProcessed;

      log.info(
        {
          totalCycles: shiftStats.dispatchCycles,
          eventsProcessed: result.eventsProcessed,
          graphInvoked: result.graphInvoked,
          durationMs: result.duration,
        },
        "Dispatch cycle completed",
      );
      return true;
    } catch (err) {
      log.error({ err }, "Dispatch cycle failed");
      shiftStats.errorsEncountered++;
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // writeShiftSummary
  // -------------------------------------------------------------------------

  /**
   * Write end-of-shift summary to PostgreSQL.
   *
   * Uses the pre-initialized PostgreSQL connection.
   */
  async function writeShiftSummary(stats: ShiftStats): Promise<boolean> {
    const shiftEndedAt = new Date();

    log.info(
      {
        shiftStartedAt: stats.shiftStartedAt,
        shiftEndedAt: shiftEndedAt.toISOString(),
        dispatchCycles: stats.dispatchCycles,
        ontologySyncs: stats.ontologySyncs,
        actionsExecuted: stats.actionsExecuted,
        errorsEncountered: stats.errorsEncountered,
        browserReconnections: stats.browserReconnections,
      },
      "Writing shift summary",
    );

    try {
      await dbWriteShiftSummary(connections.db, {
        shiftDate: toDateString(new Date(stats.shiftStartedAt)),
        startTime: new Date(stats.shiftStartedAt),
        endTime: shiftEndedAt,
        totalActions: stats.actionsExecuted,
        ordersHandled: 0,
        ticketsResolved: 0,
        messagesSent: 0,
        escalations: 0,
        notes: `Dispatch cycles: ${stats.dispatchCycles}, Syncs: ${stats.ontologySyncs}, Errors: ${stats.errorsEncountered}, Browser reconnections: ${stats.browserReconnections}`,
      });
      log.info("Shift summary written to PostgreSQL");
      return true;
    } catch (err) {
      log.error({ err }, "Failed to write shift summary to PostgreSQL — logging only");
      return true; // Don't fail the workflow for a summary write failure
    }
  }

  // -------------------------------------------------------------------------
  // disconnectBrowser
  // -------------------------------------------------------------------------

  /**
   * Gracefully disconnect from the Chrome browser.
   *
   * Uses the pre-initialized browser handle from connections.
   */
  async function disconnectBrowser(): Promise<void> {
    log.info("Disconnecting from Chrome");

    try {
      if (connections.browser) {
        await doDisconnectBrowser(connections.browser);
        connections.browser = null;
        connections.page = null;
        log.info("Chrome disconnected");
      } else {
        log.info("No browser to disconnect");
      }
    } catch (err) {
      log.error({ err }, "Error disconnecting from Chrome");
      connections.browser = null;
      connections.page = null;
    }
  }

  // -------------------------------------------------------------------------
  // isWithinBusinessHours
  // -------------------------------------------------------------------------

  /**
   * Check if the current time is within configured business hours.
   *
   * Uses BUSINESS_HOURS_START, BUSINESS_HOURS_END, and BUSINESS_TIMEZONE
   * from the environment configuration.
   */
  async function isWithinBusinessHours(): Promise<boolean> {
    const { BUSINESS_HOURS_START, BUSINESS_HOURS_END, BUSINESS_TIMEZONE } = env;

    // Get current time in the configured timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TIMEZONE,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    const currentMinutes = hour * 60 + minute;

    // Parse start/end times
    const [startHour, startMin] = BUSINESS_HOURS_START.split(":").map(Number);
    const [endHour, endMin] = BUSINESS_HOURS_END.split(":").map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    const withinHours = currentMinutes >= startMinutes && currentMinutes < endMinutes;

    log.debug(
      {
        currentTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        businessHours: `${BUSINESS_HOURS_START}-${BUSINESS_HOURS_END}`,
        timezone: BUSINESS_TIMEZONE,
        withinHours,
      },
      withinHours ? "Within business hours" : "Outside business hours",
    );

    return withinHours;
  }

  // -------------------------------------------------------------------------
  // getShiftStats
  // -------------------------------------------------------------------------

  /**
   * Return current shift statistics.
   */
  async function getShiftStats(): Promise<ShiftStats> {
    return { ...shiftStats };
  }

  // -------------------------------------------------------------------------
  // Return all activities
  // -------------------------------------------------------------------------

  return {
    startBrowser,
    authenticateDispatch,
    syncOntology,
    runDispatchCycle,
    writeShiftSummary,
    disconnectBrowser,
    isWithinBusinessHours,
    getShiftStats,
  };
}

// ---------------------------------------------------------------------------
// Type export for the activity function signatures
// ---------------------------------------------------------------------------

export type SisyphusActivities = ReturnType<typeof createActivities>;
