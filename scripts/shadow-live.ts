/**
 * Shadow Live — runs the full Sisyphus pipeline in shadow mode.
 *
 * Thin wrapper around core modules:
 *   - Fetches dispatch.txt from S3 every 20s
 *   - Fetches tickets from DynamoDB every 60s
 *   - Feeds into DispatchCycle.run() which handles diffing, prompting, graph invocation
 *   - Logs to reports/shadow-live-{date}.md
 *
 * Run:  npx tsx scripts/shadow-live.ts
 * Stop: Ctrl+C
 */

import "dotenv/config";
// OTel + Langfuse must initialise before any LangChain imports
import "../src/instrumentation.js";
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

import { OntologyStore } from "../src/ontology/state/store.js";
import { OntologySyncer } from "../src/ontology/sync/syncer.js";
import { transformTicket } from "../src/ontology/sync/transformer.js";
import { registerAllActions } from "../src/ontology/actions/index.js";
import { createDispatchGraph } from "../src/agents/graph.js";
import { DispatchCycle } from "../src/events/cycle.js";
import { EventQueue } from "../src/events/queue.js";
import { createRedisClient, type RedisClient } from "../src/memory/redis/client.js";
import { createPostgresClient } from "../src/memory/postgres/client.js";
import { writeAuditRecord } from "../src/memory/postgres/queries.js";
import { ShadowExecutor } from "../src/execution/shadow/executor.js";
import { ShadowMetrics } from "../src/execution/shadow/metrics.js";
import { startHealthServer } from "../src/health/server.js";
import { checkRedis, checkOntologyStore, aggregateHealth } from "../src/health/checks.js";
import { SseManager } from "../src/api/sse.js";
import { createDashboardRoutes } from "../src/api/handlers.js";
import { generateShiftReport } from "../src/shift/report.js";
import { formatReportAsMarkdown } from "../src/shift/report-formatter.js";
import { formatReportAsJson } from "../src/shift/report-formatter-json.js";
import { createChildLogger } from "../src/lib/logger.js";
import type { AuditRecord } from "../src/guardrails/types.js";
import type http from "node:http";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REGION = process.env.AWS_REGION ?? "us-east-1";
const POLL_INTERVAL_MS = 20_000;
const SISYPHUS_EMAIL = process.env.DISPATCH_USERNAME ?? "sisyphus@valleyeats.ca";
const TZ = process.env.BUSINESS_TIMEZONE ?? "America/Toronto";

const log = createChildLogger("shadow-live");
const s3 = new S3Client({ region: REGION });
const dynamo = new DynamoDBClient({ region: REGION });

// ---------------------------------------------------------------------------
// Log file
// ---------------------------------------------------------------------------

const logDate = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
mkdirSync("reports", { recursive: true });
const LOG_FILE = `reports/shadow-live-${logDate}.md`;

function now(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", second: "2-digit",
    hour12: true, timeZone: TZ,
  });
}

function logBoth(text: string) {
  console.log(text);
  appendFileSync(LOG_FILE, text.replace(/\x1b\[[0-9;]*m/g, "") + "\n");
}

function logFile(text: string) {
  appendFileSync(LOG_FILE, text + "\n");
}

// ---------------------------------------------------------------------------
// Redis flush — clear stale keys so each shadow-live session starts clean
// ---------------------------------------------------------------------------

async function flushSisyphusRedis(redis: RedisClient): Promise<void> {
  const patterns = ["cooldown:*", "lock:*", "circuitbreaker:*", "actions:*", "heartbeat:*"];
  let totalDeleted = 0;
  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      totalDeleted += keys.length;
    }
  }
  log.info({ totalDeleted }, "Flushed stale Redis keys for fresh shadow-live session");
}

// ---------------------------------------------------------------------------
// S3 + DynamoDB fetchers
// ---------------------------------------------------------------------------

async function fetchDispatchFile(): Promise<any> {
  const result = await s3.send(
    new GetObjectCommand({ Bucket: "valleyeats", Key: "dispatch.txt" }),
  );
  const body = await result.Body?.transformToString();
  if (!body) throw new Error("Empty dispatch.txt");
  return JSON.parse(body);
}

async function fetchRelevantTickets(): Promise<any[]> {
  const tickets: any[] = [];
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
            if (ticket.owner === "Unassigned" || ticket.owner === SISYPHUS_EMAIL) {
              tickets.push(ticket);
            }
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      log.warn({ status, err: err.message }, "Ticket query failed");
    }
  }
  return tickets;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  const sessionId = randomUUID();
  let cycleCount = 0;
  let errorCount = 0;
  const auditRecords: AuditRecord[] = [];

  logBoth(`\n\x1b[1m  Sisyphus Shadow Live\x1b[0m`);
  logBoth(`  Model: ${process.env.LLM_MODEL}`);
  logBoth(`  Log: ${LOG_FILE}`);
  logBoth(`  Poll: ${POLL_INTERVAL_MS / 1000}s\n`);

  logFile(`# Sisyphus Shadow Live — ${logDate}\nSession: ${sessionId}\nStarted: ${now()}\n---\n`);

  // ---- Infrastructure ----
  logBoth(`  [${now()}] Connecting Redis...`);
  const redis = createRedisClient(process.env.REDIS_URL ?? "redis://localhost:6379/0");

  logBoth(`  [${now()}] Flushing stale Redis keys...`);
  await flushSisyphusRedis(redis);

  logBoth(`  [${now()}] Connecting PostgreSQL...`);
  const db = createPostgresClient(
    process.env.POSTGRES_URL ?? "postgresql://sisyphus:sisyphus@localhost:5432/sisyphus",
  );

  logBoth(`  [${now()}] Registering actions...`);
  await registerAllActions();

  // ---- Core objects ----
  const store = new OntologyStore();
  const syncer = new OntologySyncer(null as any, store, log);
  const shadowMetrics = new ShadowMetrics();
  const shadowExecutor = new ShadowExecutor();
  const sseManager = new SseManager();
  const eventQueue = new EventQueue();

  // ---- Audit callback ----
  const onAudit = async (record: AuditRecord) => {
    auditRecords.push(record);
    try {
      await writeAuditRecord(db, {
        shiftId: sessionId,
        timestamp: record.timestamp,
        agentId: record.agentId,
        actionType: record.actionType,
        entityType: record.actionType.includes("Order") ? "order"
          : record.actionType.includes("Driver") ? "driver" : "ticket",
        entityId: (record.params as any)?.orderId
          ?? (record.params as any)?.driverId
          ?? (record.params as any)?.ticketId ?? "unknown",
        params: record.params,
        reasoning: record.reasoning,
        submissionCheck: record.submissionCheck,
        outcome: record.outcome,
        beforeState: record.beforeState,
        afterState: record.afterState,
        sideEffectsFired: record.sideEffectsFired,
        executionTimeMs: record.executionTimeMs,
        llmModel: record.llmModel,
        llmTokensUsed: record.llmTokensUsed,
        correlationId: record.correlationId,
      });
    } catch (err: any) {
      log.warn({ err: err.message }, "Audit write failed");
    }
    const entityId = (record.params as any)?.driverId
      ?? (record.params as any)?.orderId
      ?? (record.params as any)?.ticketId ?? "";
    // Broadcast to dashboard
    sseManager.broadcast("audit", {
      actionType: record.actionType,
      outcome: record.outcome,
      agentId: record.agentId,
      entityId,
      executionTimeMs: record.executionTimeMs,
      timestamp: record.timestamp,
    });

    const color = record.outcome === "executed" ? "\x1b[32m"
      : record.outcome === "staged" ? "\x1b[33m" : "\x1b[31m";
    logBoth(`  ${color}[${now()}] AUDIT: ${record.actionType} → ${record.outcome} | ${entityId}\x1b[0m`);
    logFile(`[${now()}] AUDIT: ${record.actionType} → ${record.outcome} | entity: ${entityId} | reason: ${record.reasoning?.slice(0, 100) ?? ""}`);
  };

  // ---- Build graph ----
  logBoth(`  [${now()}] Building graph...`);
  const graph = await createDispatchGraph(store, redis, resolve("processes"), {
    onAudit,
    shadowExecutor,
    shadowMetrics,
    correlationId: sessionId,
    processSelectionContext: {
      hasActiveOrders: true,
      hasOpenTickets: true,
      hasDriversOnShift: true,
      hasLateOrders: true,
      hasNewMessages: true,
    },
    onAgentActivity: (entry) => {
      const ts = now();
      const prefix = `[${ts}] [${entry.agent}]`;

      // --- Extract entity IDs from content for dashboard highlighting ---
      const driverMatch = entry.content.match(/"driverId":"([^"]+)"/);
      const orderMatch = entry.content.match(/"orderId":"([^"]+)"/);
      const ticketMatch = entry.content.match(/"ticketId":"([^"]+)"/) ?? entry.content.match(/"issueId":"([^"]+)"/);
      const marketMatch = entry.content.match(/"market":"([^"]+)"/);
      const entityIds: string[] = [];
      if (driverMatch) entityIds.push(`driver:${driverMatch[1]}`);
      if (orderMatch) entityIds.push(`order:${orderMatch[1]}`);
      if (ticketMatch) entityIds.push(`ticket:${ticketMatch[1]}`);
      if (marketMatch) entityIds.push(`market:${marketMatch[1]}`);

      if (entry.type === "tool_call") {
        // For assign_tasks / ASSIGN, show the routing decision clearly
        if (entry.content.startsWith("assign_tasks") || entry.content.startsWith("ASSIGN")) {
          logBoth(`${prefix} ROUTE: ${entry.content}`);
          sseManager.broadcast("activity", {
            kind: "route", agent: entry.agent, entityIds,
            summary: entry.content.slice(0, 200),
          });
        }
        // For execute_action, show what action is being taken
        else if (entry.content.startsWith("execute_action")) {
          const actionMatch2 = entry.content.match(/"actionName":"(\w+)"/);
          const msgMatch = entry.content.match(/"message":"([^"]{0,80})/);
          const action = actionMatch2?.[1] ?? "?";
          const target = driverMatch?.[1] ?? orderMatch?.[1] ?? "";
          const msg = msgMatch?.[1] ?? "";
          const summary = msg ? `${action} → ${target}: "${msg}..."` : `${action} → ${target}`;
          logBoth(`${prefix} ACTION: ${summary}`);
          logFile(`${prefix} ACTION: ${entry.content}`);
          sseManager.broadcast("activity", {
            kind: "action", agent: entry.agent, entityIds,
            summary, actionName: action,
          });
        }
        // For lookup_process, just note the query
        else if (entry.content.startsWith("lookup_process")) {
          const queryMatch = entry.content.match(/"query":"([^"]+)"/);
          logFile(`${prefix} LOOKUP: ${queryMatch?.[1] ?? entry.content.slice(0, 80)}`);
          sseManager.broadcast("activity", {
            kind: "lookup", agent: entry.agent, entityIds: [],
            summary: queryMatch?.[1] ?? "process lookup",
          });
        }
        // For queries, broadcast with entity IDs so we highlight what the AI is looking at
        else if (entry.content.startsWith("query_") || entry.content.startsWith("get_")) {
          logFile(`${prefix} QUERY: ${entry.content.slice(0, 120)}`);
          const toolName = entry.content.split("(")[0];
          sseManager.broadcast("activity", {
            kind: "query", agent: entry.agent, entityIds,
            summary: toolName,
          });
        }
        // For request_clarification, show it
        else if (entry.content.startsWith("request_clarification")) {
          logBoth(`${prefix} ESCALATE: ${entry.content.slice(0, 150)}`);
          sseManager.broadcast("activity", {
            kind: "escalate", agent: entry.agent, entityIds,
            summary: entry.content.slice(0, 150),
          });
        }
        else {
          logFile(`${prefix} TOOL: ${entry.content.slice(0, 120)}`);
        }
      } else if (entry.type === "tool_result") {
        // Only log outcomes for execute_action, skip verbose query results
        if (entry.content.includes("execute_action →") || entry.content.includes("→ {\"success\"")) {
          const outcomeMatch = entry.content.match(/"outcome":"(\w+)"/);
          const reasonMatch = entry.content.match(/"reason":"([^"]{0,100})"/);
          const outcome = outcomeMatch?.[1] ?? "?";
          if (outcome === "executed" || outcome === "staged") {
            logBoth(`${prefix} ✓ ${outcome}`);
          } else {
            logBoth(`${prefix} ✗ ${outcome}: ${reasonMatch?.[1]?.slice(0, 80) ?? ""}`);
          }
          sseManager.broadcast("activity", {
            kind: "result", agent: entry.agent, entityIds,
            summary: `${outcome}${reasonMatch?.[1] ? `: ${reasonMatch[1].slice(0, 60)}` : ""}`,
            outcome,
          });
        }
      } else if (entry.type === "response") {
        const firstLine = entry.content.split("\n").find((l: string) => l.trim().length > 0) ?? "";
        logBoth(`${prefix} DONE: ${firstLine.slice(0, 120)}`);
        sseManager.broadcast("activity", {
          kind: "done", agent: entry.agent, entityIds: [],
          summary: firstLine.slice(0, 120),
        });
      } else if (entry.type === "summary") {
        logBoth(`${prefix} SUMMARY: ${entry.content.slice(0, 120)}`);
        sseManager.broadcast("activity", {
          kind: "summary", agent: entry.agent, entityIds: [],
          summary: entry.content.slice(0, 120),
        });
      }
    },
  });

  // ---- Dispatch cycle ----
  const dispatchCycle = new DispatchCycle({
    store,
    graph,
    eventQueue,
    messageListener: null,
    redis,
    shiftId: sessionId,
    operatingMode: "shadow",
  });

  // ---- Health server + dashboard API ----
  let healthServer: http.Server | null = null;
  try {
    const getHealth = async () => {
      const components = [await checkRedis(redis), checkOntologyStore(store)];
      return aggregateHealth(components);
    };

    const dashboardRouter = createDashboardRoutes({
      store,
      getHealth,
      getShiftStats: () => ({
        shiftStartedAt: new Date(startTime).toISOString(),
        dispatchCycles: cycleCount,
        ontologySyncs: syncCount,
        actionsExecuted: auditRecords.length,
        errorsEncountered: errorCount,
        browserReconnections: 0,
      }),
      getEventQueueSize: () => eventQueue.size,
      db,
      sse: sseManager,
    });

    healthServer = startHealthServer(3000, getHealth, {}, dashboardRouter);
    logBoth(`  [${now()}] Health + dashboard API on :3000`);
  } catch { /* non-fatal */ }

  logBoth(`\n  \x1b[32m[${now()}] Ready.\x1b[0m\n`);

  // ---- Two loops: fast sync + slow graph ----
  // 1. Fast sync: fetches dispatch.txt every 20s, keeps the store fresh
  // 2. Slow graph: invokes the LLM when changes are detected, runs to completion
  //    The store stays up-to-date even while the graph is running.

  let latestDispatchData: any = null;
  let graphRunning = false;
  let syncCount = 0;

  // Fast sync — runs every POLL_INTERVAL_MS regardless of graph state
  const sync = async () => {
    syncCount++;
    try {
      const data = await fetchDispatchFile();
      latestDispatchData = data;
      syncer.syncFromDispatchFile(data);

      // Broadcast sync to dashboard
      sseManager.broadcast("sync", store.getStats());

      // Tickets every 3rd sync
      if (syncCount === 1 || syncCount % 3 === 0) {
        try {
          const tickets = await fetchRelevantTickets();
          syncer.syncTickets(tickets);
          if (tickets.length > 0 && syncCount === 1) {
            logBoth(`  [${now()}] ${tickets.length} tickets synced`);
          }
        } catch { /* non-fatal */ }
      }
    } catch (err: any) {
      logBoth(`  \x1b[31m[${now()}] Sync error: ${err.message}\x1b[0m`);
    }
  };

  // Slow graph — invoked after each sync, but only if the previous run is done
  const runCycle = async () => {
    if (graphRunning || !latestDispatchData) return;
    graphRunning = true;
    cycleCount++;

    try {
      const result = await dispatchCycle.run(latestDispatchData);

      // Broadcast cycle result to dashboard
      sseManager.broadcast("cycle", {
        cycleNumber: cycleCount,
        graphInvoked: result.graphInvoked,
        reason: result.reason,
        changesDetected: result.changesDetected,
        eventsProcessed: result.eventsProcessed,
        duration: result.duration,
      });

      if (result.graphInvoked) {
        const duration = ((result.duration ?? 0) / 1000).toFixed(1);
        logBoth(`\n  \x1b[32m[${now()}] ── Cycle #${cycleCount} done (${duration}s) ── ${result.reason} | ${result.changesDetected} changes\x1b[0m`);
        logFile(`\n── Cycle #${cycleCount} [${now()}] (${duration}s) ── ${result.reason} | ${result.changesDetected} changes\n`);
      } else if (result.changesDetected > 0) {
        logBoth(`  [${now()}] ${result.changesDetected} changes (cooldown)`);
      } else {
        process.stdout.write(".");
      }
    } catch (err: any) {
      errorCount++;
      logBoth(`  \x1b[31m[${now()}] Error: ${err.message}\x1b[0m`);
    } finally {
      graphRunning = false;
    }
  };

  // Initial sync + cycle
  await sync();
  await runCycle();

  // Then: sync every 20s, try to run cycle after each sync
  const interval = setInterval(async () => {
    await sync();
    runCycle(); // fire-and-forget — don't await, don't block next sync
  }, POLL_INTERVAL_MS);

  // ---- Shutdown ----
  process.on("SIGINT", async () => {
    clearInterval(interval);
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const metrics = shadowMetrics.getSummary();

    logBoth(`\n\x1b[1m  Summary: ${duration}min, ${cycleCount} cycles, ${errorCount} errors, ${metrics.totalProposals} proposals, ${auditRecords.length} audits\x1b[0m\n`);

    try {
      const report = generateShiftReport({
        shiftStats: {
          shiftStartedAt: new Date(startTime).toISOString(),
          dispatchCycles: cycleCount,
          ontologySyncs: cycleCount,
          actionsExecuted: auditRecords.length,
          errorsEncountered: errorCount,
          browserReconnections: 0,
        },
        proposals: shadowExecutor.getProposals?.() ?? [],
        metrics,
        auditRecords,
        tokenUsage: { totalInput: 0, totalOutput: 0, byModel: {} },
      });
      writeFileSync(`reports/shift-report-${logDate}.md`, formatReportAsMarkdown(report));
      writeFileSync(`reports/shift-report-${logDate}.json`, formatReportAsJson(report));
      logBoth(`  Shift report → reports/shift-report-${logDate}.md`);
    } catch (err: any) {
      log.warn({ err: err.message }, "Shift report failed");
    }

    sseManager.shutdown();
    healthServer?.close();
    redis.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
