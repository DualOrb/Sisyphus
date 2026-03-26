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
import { createRedisClient } from "../src/memory/redis/client.js";
import { createPostgresClient } from "../src/memory/postgres/client.js";
import { writeAuditRecord } from "../src/memory/postgres/queries.js";
import { ShadowExecutor } from "../src/execution/shadow/executor.js";
import { ShadowMetrics } from "../src/execution/shadow/metrics.js";
import { startHealthServer } from "../src/health/server.js";
import { checkRedis, checkOntologyStore, aggregateHealth } from "../src/health/checks.js";
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
    logFile(`#### Audit [${now()}] ${record.actionType} → ${record.outcome} (${record.executionTimeMs}ms)`);
    const color = record.outcome === "executed" ? "\x1b[32m"
      : record.outcome === "staged" ? "\x1b[33m" : "\x1b[31m";
    logBoth(`    ${color}AUDIT: ${record.actionType} → ${record.outcome}\x1b[0m`);
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
      const prefix = `  [${entry.agent}] i${entry.iteration}`;
      if (entry.type === "tool_call") {
        logBoth(`${prefix} 🔧 ${entry.content.slice(0, 120)}`);
        logFile(`${prefix} FULL_TOOL_CALL: ${entry.content}`);
      } else if (entry.type === "tool_result") {
        logBoth(`${prefix} → ${entry.content.slice(0, 120)}`);
        logFile(`${prefix} FULL_RESULT: ${entry.content}`);
      } else if (entry.type === "response") {
        logBoth(`${prefix} 💬 ${entry.content.slice(0, 120)}`);
        logFile(`${prefix} FULL_RESPONSE:\n${entry.content}\n---`);
      } else if (entry.type === "summary") {
        logBoth(`${prefix} 📋 ${entry.content.slice(0, 120)}`);
        logFile(`${prefix} FULL_SUMMARY:\n${entry.content}\n---`);
      }
    },
  });

  // ---- Dispatch cycle ----
  const dispatchCycle = new DispatchCycle({
    store,
    graph,
    eventQueue: new EventQueue(),
    messageListener: null,
    redis,
    shiftId: sessionId,
    operatingMode: "shadow",
  });

  // ---- Health server ----
  let healthServer: http.Server | null = null;
  try {
    healthServer = startHealthServer(3000, async () => {
      const components = [await checkRedis(redis), checkOntologyStore(store)];
      return aggregateHealth(components);
    });
    logBoth(`  [${now()}] Health server on :3000`);
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

      if (result.graphInvoked) {
        logBoth(`  \x1b[32m[${now()}] Cycle #${cycleCount}: ${result.reason} — ${result.changesDetected} changes, ${result.eventsProcessed} events\x1b[0m`);
        if (result.summary) {
          logFile(`\n### Cycle #${cycleCount} [${now()}]\n${result.summary}\n`);
        }
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

    healthServer?.close();
    redis.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
