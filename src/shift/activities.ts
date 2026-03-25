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
import { OntologyStore } from "../ontology/state/store.js";
import { DispatchApiClient } from "../ontology/sync/dispatch-api.js";
import { OntologySyncer } from "../ontology/sync/syncer.js";
import { connectBrowser, createDispatchPage, disconnectBrowser as doDisconnectBrowser } from "../execution/browser/connection.js";
import { authenticateDispatch as doAuthDispatch } from "../execution/browser/auth.js";
import { createDispatchGraph } from "../agents/graph.js";
import { createRedisClient } from "../memory/redis/client.js";
import { createPostgresClient } from "../memory/postgres/client.js";
import { writeShiftSummary as dbWriteShiftSummary } from "../memory/postgres/queries.js";
import { registerAllActions } from "../ontology/actions/index.js";
import type { Browser, Page } from "playwright";
import type { Redis } from "ioredis";
import type { HumanMessage } from "@langchain/core/messages";

const log = createChildLogger("shift:activities");

// ---------------------------------------------------------------------------
// Shared infrastructure (initialized on first use, persists across activities)
// ---------------------------------------------------------------------------

let browser: Browser | null = null;
let page: Page | null = null;
let redis: Redis | null = null;
let db: ReturnType<typeof createPostgresClient> | null = null;
let store: OntologyStore | null = null;
let syncer: OntologySyncer | null = null;
let dispatchGraph: Awaited<ReturnType<typeof createDispatchGraph>> | null = null;
let actionsRegistered = false;

function getRedis(): Redis {
  if (!redis) {
    redis = createRedisClient(env.REDIS_URL);
  }
  return redis;
}

function getDb(): ReturnType<typeof createPostgresClient> {
  if (!db) {
    db = createPostgresClient(env.POSTGRES_URL);
  }
  return db;
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getStore(): OntologyStore {
  if (!store) {
    store = new OntologyStore();
  }
  return store;
}

function getSyncer(): OntologySyncer {
  if (!syncer) {
    const api = new DispatchApiClient({
      baseUrl: env.DISPATCH_API_URL,
      authToken: "", // TODO: extract auth token from browser session cookies
      logger: log,
    });
    syncer = new OntologySyncer(api, getStore(), log);
  }
  return syncer;
}

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

  try {
    browser = await connectBrowser(cdpUrl);
    page = await createDispatchPage(browser);
    log.info("Chrome connection established");
    return true;
  } catch (err) {
    log.error({ err }, "Failed to connect to Chrome");
    browser = null;
    page = null;
    return false;
  }
}

/**
 * Authenticate Sisyphus with the dispatch UI via Cognito login flow.
 *
 * Stub: logs the authentication attempt and returns success.
 * Real implementation will call authenticateDispatch() from execution/browser/auth.ts.
 */
export async function authenticateDispatch(): Promise<boolean> {
  const { DISPATCH_API_URL, DISPATCH_USERNAME, DISPATCH_PASSWORD } = env;
  log.info({ url: DISPATCH_API_URL, username: DISPATCH_USERNAME }, "Authenticating with dispatch UI");

  if (!page) {
    log.error("No browser page available — call startBrowser() first");
    return false;
  }

  try {
    await doAuthDispatch(page, DISPATCH_API_URL, DISPATCH_USERNAME, DISPATCH_PASSWORD);
    log.info("Dispatch authentication successful");
    return true;
  } catch (err) {
    log.error({ err }, "Dispatch authentication failed");
    return false;
  }
}

/**
 * Trigger one ontology sync cycle.
 *
 * Stub: logs the sync and returns success.
 * Real implementation will call OntologySyncer.sync() from ontology/sync/syncer.ts.
 */
export async function syncOntology(): Promise<boolean> {
  log.info("Running ontology sync cycle");

  try {
    await getSyncer().sync();
    shiftStats.ontologySyncs++;
    const stats = getStore().getStats();
    log.info({ totalSyncs: shiftStats.ontologySyncs, ...stats }, "Ontology sync completed");
    return true;
  } catch (err) {
    log.error({ err }, "Ontology sync failed");
    shiftStats.errorsEncountered++;
    return false;
  }
}

/**
 * Run one iteration of the dispatch loop — invokes the LangGraph graph once.
 *
 * Stub: logs the dispatch cycle and returns success.
 * Real implementation will invoke the LangGraph supervisor agent.
 */
export async function runDispatchCycle(): Promise<boolean> {
  log.info("Running dispatch cycle (LangGraph graph invocation)");

  try {
    // Lazily build the dispatch graph on first cycle
    if (!dispatchGraph) {
      if (!actionsRegistered) {
        await registerAllActions();
        actionsRegistered = true;
      }
      const processDir = new URL("../../processes", import.meta.url).pathname;
      dispatchGraph = await createDispatchGraph(getStore(), getRedis(), processDir);
      log.info("Dispatch graph initialized");
    }

    // Build a snapshot prompt for the supervisor describing current state
    const storeStats = getStore().getStats();
    const snapshotMessage = [
      `Current shift cycle #${shiftStats.dispatchCycles + 1}.`,
      `Ontology state: ${storeStats.orders} orders, ${storeStats.drivers} drivers, ${storeStats.markets} markets, ${storeStats.tickets} tickets.`,
      `Check for issues, new messages, unassigned orders, and market health. Delegate as needed.`,
    ].join(" ");

    const { HumanMessage: HM } = await import("@langchain/core/messages");
    await dispatchGraph.invoke(
      { messages: [new HM(snapshotMessage)] },
      { configurable: { thread_id: `shift-${shiftStats.shiftStartedAt}` } },
    );

    shiftStats.dispatchCycles++;
    log.info({ totalCycles: shiftStats.dispatchCycles }, "Dispatch cycle completed");
    return true;
  } catch (err) {
    log.error({ err }, "Dispatch cycle failed");
    shiftStats.errorsEncountered++;
    return false;
  }
}

/**
 * Write end-of-shift summary to PostgreSQL.
 *
 * Fully implemented: writes the shift summary with all stats.
 * Uses the POSTGRES_URL from env to connect.
 */
export async function writeShiftSummary(stats: ShiftStats): Promise<boolean> {
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
    const database = getDb();
    await dbWriteShiftSummary(database, {
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

/**
 * Gracefully disconnect from the Chrome browser.
 *
 * Stub: logs the disconnect. Real implementation will call
 * disconnectBrowser() from execution/browser/connection.ts.
 */
export async function disconnectBrowser(): Promise<void> {
  log.info("Disconnecting from Chrome");

  try {
    if (browser) {
      await doDisconnectBrowser(browser);
      browser = null;
      page = null;
      log.info("Chrome disconnected");
    } else {
      log.info("No browser to disconnect");
    }
  } catch (err) {
    log.error({ err }, "Error disconnecting from Chrome");
    browser = null;
    page = null;
  }

  // Clean up Redis connection too
  if (redis) {
    redis.disconnect();
    redis = null;
  }
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
