/**
 * Service initialization for Sisyphus.
 *
 * Takes the initialized connections and creates all the higher-level services:
 * ontology store, syncer, LangGraph dispatch graph, event pipeline, WebSocket
 * message listener, presence, and the dispatch cycle orchestrator.
 *
 * When the system is running in shadow mode, a ShadowExecutor and ShadowMetrics
 * are created and wired into the graph's execute_action tool. All actions are
 * logged to PostgreSQL via writeAuditRecord and tracked as shadow proposals.
 *
 * Each step is logged and has error handling.
 */

import { randomUUID } from "node:crypto";
import type http from "node:http";

import type { Env } from "../config/env.js";
import type { SisyphusConnections } from "./connections.js";

import { OntologyStore } from "../ontology/state/store.js";
import { DriverLocationHistory } from "../ontology/state/location-history.js";
import { OntologySyncer } from "../ontology/sync/syncer.js";
import { seedLocationHistoryFromS3 } from "../ontology/sync/dispatch-images.js";
import { registerAllActions } from "../ontology/actions/index.js";
import {
  createDispatchGraph,
  guessEntityType,
  guessEntityId,
  type OnAuditCallback,
} from "../agents/graph.js";
import { EventDetector } from "../events/detector.js";
import { EventQueue } from "../events/queue.js";
import { EventDispatcher } from "../events/dispatcher.js";
import { DispatchCycle } from "../events/cycle.js";
import { DispatchWebSocket } from "../execution/websocket/client.js";
import { MessageListener } from "../execution/websocket/message-listener.js";
import { SisyphusPresence } from "../execution/websocket/presence.js";
import { ShadowExecutor } from "../execution/shadow/executor.js";
import { ShadowMetrics } from "../execution/shadow/metrics.js";
import { isShadowMode } from "../config/mode.js";
import { writeAuditRecord, getShiftHandoff } from "../memory/postgres/queries.js";
import { startHealthServer } from "../health/server.js";
import {
  checkRedis,
  checkPostgres,
  checkOntologyStore,
  aggregateHealth,
} from "../health/checks.js";
import { SseManager } from "../api/sse.js";
import { createDashboardRoutes } from "../api/handlers.js";
import { createChildLogger } from "../lib/logger.js";
import type { AuditRecord } from "../guardrails/types.js";
import type { ShiftSummaryRow } from "../../db/schema.js";

const log = createChildLogger("init:services");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The compiled dispatch graph type. We use the broad CompiledStateGraph type
 * since the exact generic parameters are internal to createDispatchGraph.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CompiledGraph = Awaited<ReturnType<typeof createDispatchGraph>>;

export interface SisyphusServices {
  store: OntologyStore;
  syncer: OntologySyncer;
  /** Tracks driver GPS positions over time for movement analysis. */
  locationHistory: DriverLocationHistory;
  graph: CompiledGraph;
  eventDetector: EventDetector;
  eventQueue: EventQueue;
  eventDispatcher: EventDispatcher;
  messageListener: MessageListener;
  presence: SisyphusPresence | null;
  dispatchCycle: DispatchCycle;
  /** ShadowExecutor — always created; in non-shadow mode it is simply unused. */
  shadowExecutor: ShadowExecutor;
  /** ShadowMetrics — always created for proposal tracking. */
  shadowMetrics: ShadowMetrics;
  /** Health server HTTP instance, if started. */
  healthServer: http.Server | null;
  /** SSE manager for dashboard real-time updates. */
  sseManager: SseManager;
  /** Shift-scoped correlation ID used by audit records. */
  shiftId: string;
  /** Accumulated audit records for shift report generation. */
  auditRecords: AuditRecord[];
  /** Previous shift handoff data for cross-shift awareness. */
  shiftHandoff: ShiftSummaryRow | null;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize all Sisyphus services on top of established connections.
 *
 * Steps:
 *  1.  Register all action types (guardrails registry)
 *  2.  Create OntologyStore
 *  3.  Create OntologySyncer from adapter
 *  4.  Run initial ontology sync
 *  5.  Create ShadowExecutor and ShadowMetrics
 *  6.  Build onAudit callback (PostgreSQL + shadow proposals + logging)
 *  7.  Create LangGraph dispatch graph with audit wiring
 *  8.  Create event pipeline (detector, queue, dispatcher)
 *  9.  Create WebSocket client and message listener
 *  10. Create SisyphusPresence
 *  11. Create DispatchCycle
 *  12. Start health server on port 3000
 *
 * @param connections - Initialized connections from initializeConnections()
 * @param envVars - Environment variables
 */
export async function initializeServices(
  connections: SisyphusConnections,
  envVars: Env,
): Promise<SisyphusServices> {
  log.info("Initializing Sisyphus services...");

  const shiftId = randomUUID();
  const auditRecords: AuditRecord[] = [];

  // ---- 1. Register all action types ----------------------------------------
  log.info("Registering all action types");
  await registerAllActions();
  log.info("Action types registered");

  // ---- 2. Create OntologyStore ---------------------------------------------
  log.info("Creating OntologyStore");
  const store = new OntologyStore();
  log.info("OntologyStore created");

  // ---- 3. Create OntologySyncer from adapter --------------------------------
  log.info("Creating OntologySyncer from dispatch adapter");

  // Bridge the DispatchAdapter interface to OntologySyncSource
  // (DispatchAdapter uses fetchActiveOrders, OntologySyncSource expects fetchOrders)
  const syncSource = {
    fetchOrders: (zone?: string) => connections.adapter.fetchActiveOrders(zone),
    fetchDrivers: (zone?: string) => connections.adapter.fetchDrivers(zone),
    fetchIssues: (status?: string) => connections.adapter.fetchIssues(undefined, status),
    fetchMarketState: () => connections.adapter.fetchMarketState(),
  };

  const syncer = OntologySyncer.fromAdapter(syncSource, store, log);
  log.info("OntologySyncer created");

  // ---- 3b. Create and attach DriverLocationHistory -------------------------
  log.info("Creating DriverLocationHistory (60-min window)");
  const locationHistory = new DriverLocationHistory();
  syncer.setLocationHistory(locationHistory);
  log.info("DriverLocationHistory attached to syncer");

  // ---- 4. Run initial ontology sync ----------------------------------------
  log.info("Running initial ontology sync");
  try {
    await syncer.sync();
    const stats = store.getStats();
    log.info(
      {
        orders: stats.orders,
        drivers: stats.drivers,
        restaurants: stats.restaurants,
        tickets: stats.tickets,
        markets: stats.markets,
      },
      "Initial ontology sync completed",
    );
  } catch (err) {
    log.warn(
      { err },
      "Initial ontology sync failed — continuing with empty store (sync will retry on next cycle)",
    );
  }

  // ---- 4a. Seed location history from DispatchImages (non-blocking) --------
  // Fetch last 10 minutes of S3 snapshots in the background so it doesn't
  // block startup. If it fails, we just start with an empty history.
  seedLocationHistoryFromS3(locationHistory, log, { minutes: 10 }).catch(
    (err) => {
      log.warn(
        { err },
        "Failed to seed location history from DispatchImages — continuing with empty history",
      );
    },
  );

  // ---- 4b. Retrieve previous shift handoff for cross-shift awareness -------
  let shiftHandoff: ShiftSummaryRow | null = null;
  try {
    shiftHandoff = await getShiftHandoff(connections.db);
    if (shiftHandoff) {
      log.info(
        {
          shiftDate: shiftHandoff.shiftDate,
          totalActions: shiftHandoff.totalActions,
          escalations: shiftHandoff.escalations,
          hasNotes: !!shiftHandoff.notes,
          hasIssues: !!shiftHandoff.issues,
        },
        "Previous shift handoff retrieved",
      );
    } else {
      log.info("No previous shift handoff found");
    }
  } catch (err) {
    log.warn({ err }, "Failed to retrieve shift handoff — continuing without cross-shift context");
  }

  // ---- 5. Create ShadowExecutor and ShadowMetrics --------------------------
  log.info("Creating ShadowExecutor and ShadowMetrics");
  const shadowMetrics = new ShadowMetrics();

  const shadowExecutor = new ShadowExecutor(async (proposal) => {
    shadowMetrics.record(proposal);
    log.info(
      {
        proposalId: proposal.id,
        actionName: proposal.actionName,
        tier: proposal.tier,
        wouldExecuteVia: proposal.wouldExecuteVia,
      },
      "Shadow proposal recorded",
    );
  });
  log.info({ isShadow: isShadowMode() }, "ShadowExecutor and ShadowMetrics created");

  // ---- 5b. Create SSE manager for dashboard (early so onAudit can use it) --
  const sseManager = new SseManager();

  // ---- 6. Build onAudit callback -------------------------------------------
  const onAudit: OnAuditCallback = async (record: AuditRecord) => {
    // 6a. Write to PostgreSQL
    try {
      await writeAuditRecord(connections.db, {
        shiftId,
        timestamp: record.timestamp,
        agentId: record.agentId,
        actionType: record.actionType,
        entityType: guessEntityType(record.actionType),
        entityId: guessEntityId(record.params),
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
    } catch (err) {
      log.warn({ err }, "Failed to write audit record to PostgreSQL");
    }

    // 6b. Accumulate for shift report
    auditRecords.push(record);

    // 6c. Broadcast to dashboard via SSE
    sseManager.broadcast("audit", {
      actionType: record.actionType,
      outcome: record.outcome,
      agentId: record.agentId,
      entityType: guessEntityType(record.actionType),
      entityId: guessEntityId(record.params),
      executionTimeMs: record.executionTimeMs,
      timestamp: record.timestamp,
    });

    // 6d. Console log
    log.info(
      {
        actionType: record.actionType,
        outcome: record.outcome,
        agentId: record.agentId,
        auditId: record.id,
        executionTimeMs: record.executionTimeMs,
      },
      "Action audit recorded",
    );
  };
  log.info("Audit callback configured (PostgreSQL + shadow metrics + SSE)");

  // ---- 7. Create LangGraph dispatch graph ----------------------------------
  log.info("Creating LangGraph dispatch graph");
  const processDir = new URL("../../processes", import.meta.url).pathname;

  const graph = await createDispatchGraph(store, connections.redis, processDir, {
    onAudit,
    shadowExecutor,
    shadowMetrics,
    correlationId: shiftId,
    locationHistory,
    processSelectionContext: {
      hasActiveOrders: true,
      hasOpenTickets: true,
      hasDriversOnShift: true,
      hasLateOrders: true,
      hasNewMessages: true,
    },
    onAgentActivity: (entry) => {
      // Extract entity IDs from content for dashboard highlighting
      const driverMatch = entry.content.match(/"driverId":"([^"]+)"/);
      const orderMatch = entry.content.match(/"orderId":"([^"]+)"/);
      const ticketMatch = entry.content.match(/"ticketId":"([^"]+)"/) ?? entry.content.match(/"issueId":"([^"]+)"/);
      const entityIds: string[] = [];
      if (driverMatch) entityIds.push(`driver:${driverMatch[1]}`);
      if (orderMatch) entityIds.push(`order:${orderMatch[1]}`);
      if (ticketMatch) entityIds.push(`ticket:${ticketMatch[1]}`);

      if (entry.type === "tool_call") {
        if (entry.content.startsWith("assign_tasks") || entry.content.startsWith("ASSIGN")) {
          sseManager.broadcast("activity", { kind: "route", agent: entry.agent, entityIds, summary: entry.content.slice(0, 200) });
        } else if (entry.content.startsWith("execute_action")) {
          const actionMatch = entry.content.match(/"actionName":"(\w+)"/);
          const target = driverMatch?.[1] ?? orderMatch?.[1] ?? "";
          sseManager.broadcast("activity", { kind: "action", agent: entry.agent, entityIds, summary: `${actionMatch?.[1] ?? "?"} → ${target}`, actionName: actionMatch?.[1] });
        } else if (entry.content.startsWith("query_") || entry.content.startsWith("get_")) {
          sseManager.broadcast("activity", { kind: "query", agent: entry.agent, entityIds, summary: entry.content.split("(")[0] });
        } else if (entry.content.startsWith("request_clarification")) {
          sseManager.broadcast("activity", { kind: "escalate", agent: entry.agent, entityIds, summary: entry.content.slice(0, 150) });
        }
      } else if (entry.type === "tool_result" && (entry.content.includes("execute_action →") || entry.content.includes("→ {\"success\""))) {
        const outcome = entry.content.match(/"outcome":"(\w+)"/)?.[1] ?? "?";
        sseManager.broadcast("activity", { kind: "result", agent: entry.agent, entityIds, summary: outcome, outcome });
      } else if (entry.type === "response") {
        const firstLine = entry.content.split("\n").find((l: string) => l.trim()) ?? "";
        sseManager.broadcast("activity", { kind: "done", agent: entry.agent, entityIds: [], summary: firstLine.slice(0, 120) });
      }
    },
  });
  log.info("Dispatch graph compiled");

  // ---- 8. Create event pipeline --------------------------------------------
  log.info("Creating event pipeline");
  const eventDetector = new EventDetector();
  const eventQueue = new EventQueue();
  const eventDispatcher = new EventDispatcher();
  log.info("Event pipeline created (detector, queue, dispatcher)");

  // ---- 9. Create WebSocket client and message listener ---------------------
  log.info("Creating WebSocket message listener");
  const wsClient = new DispatchWebSocket();
  const messageListener = new MessageListener();

  // Connect WebSocket if we have a session cookie (the WS needs an auth token)
  if (connections.sessionCookie && envVars.DISPATCH_WS_URL) {
    log.info({ wsUrl: envVars.DISPATCH_WS_URL }, "Connecting dispatch WebSocket");
    try {
      wsClient.connect(envVars.DISPATCH_WS_URL, connections.sessionCookie);
      messageListener.attach(wsClient);
      // Store the client on the connections so shutdown can find it
      connections.wsClient = wsClient;
      log.info("Dispatch WebSocket connected, message listener attached");
    } catch (err) {
      log.warn(
        { err },
        "Failed to connect dispatch WebSocket — continuing without real-time messages",
      );
    }
  } else {
    log.info("Skipping WebSocket connection (no session cookie or WS URL)");
    messageListener.attach(wsClient); // attach anyway for the interface
  }

  // ---- 10. Create SisyphusPresence ------------------------------------------
  let presence: SisyphusPresence | null = null;
  if (wsClient.connected) {
    log.info("Creating SisyphusPresence");
    presence = new SisyphusPresence(wsClient);
    presence.broadcast();
    log.info("SisyphusPresence created and initial broadcast sent");
  } else {
    log.info("Skipping SisyphusPresence (WebSocket not connected)");
  }

  // ---- 11. Create DispatchCycle ---------------------------------------------
  log.info("Creating DispatchCycle");
  const dispatchCycle = new DispatchCycle({
    store,
    graph,
    eventQueue,
    messageListener,
    redis: connections.redis,
    shiftHandoff,
    shiftId,
    operatingMode: envVars.OPERATING_MODE,
  });
  log.info("DispatchCycle created");

  // ---- 12. Start health server + dashboard API on port 3000 (non-fatal) ----
  let healthServer: http.Server | null = null;
  try {
    const getHealth = async () => {
      const components = await Promise.all([
        checkRedis(connections.redis),
        checkPostgres(connections.db),
        checkOntologyStore(store),
      ]);
      return aggregateHealth(components);
    };

    // Build dashboard API routes
    const dashboardRouter = createDashboardRoutes({
      store,
      getHealth,
      getShiftStats: () => ({
        shiftStartedAt: new Date().toISOString(),
        dispatchCycles: 0,
        ontologySyncs: 0,
        actionsExecuted: auditRecords.length,
        errorsEncountered: 0,
        browserReconnections: 0,
      }),
      getEventQueueSize: () => eventQueue.size,
      db: connections.db,
      sse: sseManager,
    });

    healthServer = startHealthServer(3000, getHealth, {}, dashboardRouter);
    log.info("Health server + dashboard API started on port 3000");
  } catch (err) {
    log.warn({ err }, "Health server failed to start — continuing without health endpoint");
  }

  log.info("All services initialized successfully");

  return {
    store,
    syncer,
    locationHistory,
    graph,
    eventDetector,
    eventQueue,
    eventDispatcher,
    messageListener,
    presence,
    dispatchCycle,
    shadowExecutor,
    shadowMetrics,
    healthServer,
    sseManager,
    shiftId,
    auditRecords,
    shiftHandoff,
  };
}
