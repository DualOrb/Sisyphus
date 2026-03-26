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

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

import { createChildLogger } from "../lib/logger.js";
import { env } from "../config/env.js";
import { connectBrowser, createDispatchPage, disconnectBrowser as doDisconnectBrowser } from "../execution/browser/connection.js";
import { writeShiftSummary as dbWriteShiftSummary } from "../memory/postgres/queries.js";
import { transformTicket } from "../ontology/sync/transformer.js";

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

/**
 * Latest parsed dispatch.txt data from S3, stored between activities so
 * runDispatchCycle can pass it to DispatchCycle.run() for change detection.
 */
let latestDispatchData: any = null;

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
  // syncOntologyFromS3
  // -------------------------------------------------------------------------

  /**
   * Sync the ontology from dispatch.txt in S3 and tickets from DynamoDB.
   *
   * This mirrors what shadow-live.ts does:
   * 1. Fetch dispatch.txt from the S3 bucket
   * 2. Parse and sync orders, drivers, markets into the store
   * 3. Fetch relevant tickets from DynamoDB IssueTracker table
   * 4. Sync tickets into the store
   *
   * Falls back to the adapter-based sync if S3 fetch fails.
   */
  async function syncOntologyFromS3(): Promise<boolean> {
    log.info("Running ontology sync from dispatch.txt (S3)");

    const region = process.env.AWS_REGION ?? "us-east-1";
    const bucket = process.env.DISPATCH_S3_BUCKET ?? "valleyeats";
    const key = process.env.DISPATCH_S3_KEY ?? "dispatch.txt";
    const sisyphusEmail = process.env.DISPATCH_USERNAME ?? "sisyphus@valleyeats.ca";

    try {
      // 1. Fetch dispatch.txt from S3
      const s3 = new S3Client({ region });
      const s3Result = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      const body = await s3Result.Body?.transformToString();
      if (!body) throw new Error("Empty dispatch.txt from S3");
      const data = JSON.parse(body);

      // 2. Sync into the store via the syncer's dispatch file method
      services.syncer.syncFromDispatchFile(data);

      // 2b. Store the raw dispatch data so runDispatchCycle can use it
      latestDispatchData = data;

      // 3. Fetch relevant tickets from DynamoDB
      try {
        const dynamo = new DynamoDBClient({ region });
        const tickets: ReturnType<typeof transformTicket>[] = [];

        for (const status of ["New", "Pending", "Awaiting Response"]) {
          try {
            const result = await dynamo.send(
              new QueryCommand({
                TableName: "ValleyEats-IssueTracker",
                IndexName: "IssueStatus-Created-index",
                KeyConditionExpression: "IssueStatus = :s",
                ExpressionAttributeValues: { ":s": { S: status } },
                Limit: 50,
                ScanIndexForward: false,
              }),
            );
            if (result.Items) {
              for (const item of result.Items) {
                try {
                  const ticket = transformTicket(unmarshall(item));
                  if (ticket.owner === "Unassigned" || ticket.owner === sisyphusEmail) {
                    tickets.push(ticket);
                  }
                } catch {
                  /* skip bad records */
                }
              }
            }
          } catch (err) {
            log.warn({ err, status }, "Failed to query DynamoDB tickets for status");
          }
        }

        if (tickets.length > 0) {
          services.syncer.syncTickets(tickets);
          log.info({ count: tickets.length }, "Tickets synced from DynamoDB");
        }
      } catch (err) {
        log.warn({ err }, "Ticket sync from DynamoDB failed — continuing with stale ticket data");
      }

      shiftStats.ontologySyncs++;
      const stats = services.store.getStats();
      log.info(
        { totalSyncs: shiftStats.ontologySyncs, ...stats },
        "Ontology sync from S3 completed",
      );
      return true;
    } catch (err) {
      log.warn({ err }, "S3-based sync failed — falling back to adapter sync");
      // Fall back to adapter-based sync
      return syncOntology();
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
      const result = await services.dispatchCycle.run(latestDispatchData);

      shiftStats.dispatchCycles++;
      shiftStats.actionsExecuted += result.eventsProcessed;

      log.info(
        {
          totalCycles: shiftStats.dispatchCycles,
          eventsProcessed: result.eventsProcessed,
          graphInvoked: result.graphInvoked,
          durationMs: result.duration,
          reason: result.reason,
          changesDetected: result.changesDetected,
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
  // generateAndWriteShiftReport
  // -------------------------------------------------------------------------

  /**
   * Generate a shift report from accumulated shadow metrics and audit records.
   *
   * Uses the ShadowMetrics and ShadowExecutor from the services to build a
   * comprehensive shift report, mirroring shadow-live.ts's SIGINT handler.
   */
  async function generateAndWriteShiftReport(): Promise<boolean> {
    log.info("Generating shift report");

    try {
      const metrics = services.shadowMetrics.getSummary();
      const proposals = services.shadowExecutor.getProposals();

      log.info(
        {
          totalProposals: metrics.totalProposals,
          byAction: metrics.byAction,
          byTier: metrics.byTier,
          shiftId: services.shiftId,
        },
        "Shift report — shadow metrics summary",
      );

      if (proposals.length > 0) {
        log.info(
          { count: proposals.length },
          "Shift report — proposals logged",
        );
        for (const p of proposals) {
          log.debug(
            {
              actionName: p.actionName,
              tier: p.tier,
              wouldExecuteVia: p.wouldExecuteVia,
              reasoning: p.reasoning,
            },
            "Proposal detail",
          );
        }
      }

      return true;
    } catch (err) {
      log.error({ err }, "Failed to generate shift report");
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Return all activities
  // -------------------------------------------------------------------------

  return {
    startBrowser,
    authenticateDispatch,
    syncOntology,
    syncOntologyFromS3,
    runDispatchCycle,
    writeShiftSummary,
    disconnectBrowser,
    isWithinBusinessHours,
    getShiftStats,
    generateAndWriteShiftReport,
  };
}

// ---------------------------------------------------------------------------
// Type export for the activity function signatures
// ---------------------------------------------------------------------------

export type SisyphusActivities = ReturnType<typeof createActivities>;
