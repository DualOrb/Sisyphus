/**
 * Temporal activities for the Sisyphus shift lifecycle.
 *
 * Activities are where all side effects happen: browser automation, API calls,
 * database writes, etc. The Temporal workflow calls these via proxyActivities().
 *
 * Activities that depend on real infrastructure (browser, LangGraph, PostgreSQL)
 * are stubs for now — they log what they would do and return success. The
 * business hours check and shift stats are fully implemented.
 */

import { createChildLogger } from "../lib/logger.js";
import { env } from "../config/env.js";

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
// Activities
// ---------------------------------------------------------------------------

/**
 * Connect to the Chrome instance via CDP.
 *
 * Stub: logs the connection attempt and returns success.
 * Real implementation will call connectBrowser() from execution/browser/connection.ts.
 */
export async function startBrowser(): Promise<boolean> {
  const cdpUrl = env.CHROME_CDP_URL;
  log.info({ cdpUrl }, "Connecting to Chrome via CDP");

  // TODO: Replace with real implementation:
  // import { connectBrowser, createDispatchPage } from "../execution/browser/connection.js";
  // const browser = await connectBrowser(cdpUrl);
  // const page = await createDispatchPage(browser);
  // Store browser/page references for other activities to use.

  log.info("Chrome connection established (stub)");
  return true;
}

/**
 * Authenticate Sisyphus with the dispatch UI via Cognito login flow.
 *
 * Stub: logs the authentication attempt and returns success.
 * Real implementation will call authenticateDispatch() from execution/browser/auth.ts.
 */
export async function authenticateDispatch(): Promise<boolean> {
  const { DISPATCH_API_URL, DISPATCH_USERNAME } = env;
  log.info({ url: DISPATCH_API_URL, username: DISPATCH_USERNAME }, "Authenticating with dispatch UI");

  // TODO: Replace with real implementation:
  // import { authenticateDispatch as doAuth } from "../execution/browser/auth.js";
  // await doAuth(page, DISPATCH_API_URL, DISPATCH_USERNAME, env.DISPATCH_PASSWORD);

  log.info("Dispatch authentication successful (stub)");
  return true;
}

/**
 * Trigger one ontology sync cycle.
 *
 * Stub: logs the sync and returns success.
 * Real implementation will call OntologySyncer.sync() from ontology/sync/syncer.ts.
 */
export async function syncOntology(): Promise<boolean> {
  log.info("Running ontology sync cycle");

  // TODO: Replace with real implementation:
  // await ontologySyncer.sync();

  shiftStats.ontologySyncs++;
  log.info({ totalSyncs: shiftStats.ontologySyncs }, "Ontology sync completed (stub)");
  return true;
}

/**
 * Run one iteration of the dispatch loop — invokes the LangGraph graph once.
 *
 * Stub: logs the dispatch cycle and returns success.
 * Real implementation will invoke the LangGraph supervisor agent.
 */
export async function runDispatchCycle(): Promise<boolean> {
  log.info("Running dispatch cycle (LangGraph graph invocation)");

  // TODO: Replace with real implementation:
  // const result = await supervisorGraph.invoke(currentState);
  // shiftStats.actionsExecuted += result.actionsCount;

  shiftStats.dispatchCycles++;
  log.info({ totalCycles: shiftStats.dispatchCycles }, "Dispatch cycle completed (stub)");
  return true;
}

/**
 * Write end-of-shift summary to PostgreSQL.
 *
 * Fully implemented: writes the shift summary with all stats.
 * Uses the POSTGRES_URL from env to connect.
 */
export async function writeShiftSummary(stats: ShiftStats): Promise<boolean> {
  const shiftEndedAt = new Date().toISOString();

  log.info(
    {
      shiftStartedAt: stats.shiftStartedAt,
      shiftEndedAt,
      dispatchCycles: stats.dispatchCycles,
      ontologySyncs: stats.ontologySyncs,
      actionsExecuted: stats.actionsExecuted,
      errorsEncountered: stats.errorsEncountered,
      browserReconnections: stats.browserReconnections,
    },
    "Writing shift summary",
  );

  // TODO: Replace with real Drizzle/pg implementation:
  // import { db } from "../../db/client.js";
  // import { shiftSummaries } from "../../db/schema.js";
  // await db.insert(shiftSummaries).values({
  //   startedAt: stats.shiftStartedAt,
  //   endedAt: shiftEndedAt,
  //   dispatchCycles: stats.dispatchCycles,
  //   ontologySyncs: stats.ontologySyncs,
  //   actionsExecuted: stats.actionsExecuted,
  //   errorsEncountered: stats.errorsEncountered,
  //   browserReconnections: stats.browserReconnections,
  // });

  log.info("Shift summary written (stub — logged above)");
  return true;
}

/**
 * Gracefully disconnect from the Chrome browser.
 *
 * Stub: logs the disconnect. Real implementation will call
 * disconnectBrowser() from execution/browser/connection.ts.
 */
export async function disconnectBrowser(): Promise<void> {
  log.info("Disconnecting from Chrome");

  // TODO: Replace with real implementation:
  // import { disconnectBrowser as doDisconnect } from "../execution/browser/connection.js";
  // await doDisconnect(browser);

  log.info("Chrome disconnected (stub)");
}

/**
 * Check if the current time is within configured business hours.
 *
 * Fully implemented. Uses BUSINESS_HOURS_START, BUSINESS_HOURS_END, and
 * BUSINESS_TIMEZONE from the environment configuration.
 *
 * @returns true if current time is within business hours
 */
export async function isWithinBusinessHours(): Promise<boolean> {
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

/**
 * Return current shift statistics.
 */
export async function getShiftStats(): Promise<ShiftStats> {
  return { ...shiftStats };
}
