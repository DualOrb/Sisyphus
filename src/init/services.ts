/**
 * Service initialization for Sisyphus.
 *
 * Takes the initialized connections and creates all the higher-level services:
 * ontology store, syncer, LangGraph dispatch graph, event pipeline, WebSocket
 * message listener, presence, and the dispatch cycle orchestrator.
 *
 * Each step is logged and has error handling.
 */

import type { Env } from "../config/env.js";
import type { SisyphusConnections } from "./connections.js";

import { OntologyStore } from "../ontology/state/store.js";
import { OntologySyncer } from "../ontology/sync/syncer.js";
import { registerAllActions } from "../ontology/actions/index.js";
import { createDispatchGraph } from "../agents/graph.js";
import { EventDetector } from "../events/detector.js";
import { EventQueue } from "../events/queue.js";
import { EventDispatcher } from "../events/dispatcher.js";
import { DispatchCycle } from "../events/cycle.js";
import { DispatchWebSocket } from "../execution/websocket/client.js";
import { MessageListener } from "../execution/websocket/message-listener.js";
import { SisyphusPresence } from "../execution/websocket/presence.js";
import { createChildLogger } from "../lib/logger.js";

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
  graph: CompiledGraph;
  eventDetector: EventDetector;
  eventQueue: EventQueue;
  eventDispatcher: EventDispatcher;
  messageListener: MessageListener;
  presence: SisyphusPresence | null;
  dispatchCycle: DispatchCycle;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize all Sisyphus services on top of established connections.
 *
 * Steps:
 *  1. Register all action types (guardrails registry)
 *  2. Create OntologyStore
 *  3. Create OntologySyncer from adapter
 *  4. Run initial ontology sync
 *  5. Create LangGraph dispatch graph
 *  6. Create event pipeline (detector, queue, dispatcher)
 *  7. Create WebSocket client and message listener
 *  8. Create SisyphusPresence
 *  9. Create DispatchCycle
 *
 * @param connections - Initialized connections from initializeConnections()
 * @param envVars - Environment variables
 */
export async function initializeServices(
  connections: SisyphusConnections,
  envVars: Env,
): Promise<SisyphusServices> {
  log.info("Initializing Sisyphus services...");

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

  // ---- 5. Create LangGraph dispatch graph ----------------------------------
  log.info("Creating LangGraph dispatch graph");
  const processDir = new URL("../../processes", import.meta.url).pathname;
  const graph = await createDispatchGraph(store, connections.redis, processDir);
  log.info("Dispatch graph compiled");

  // ---- 6. Create event pipeline --------------------------------------------
  log.info("Creating event pipeline");
  const eventDetector = new EventDetector();
  const eventQueue = new EventQueue();
  const eventDispatcher = new EventDispatcher();
  log.info("Event pipeline created (detector, queue, dispatcher)");

  // ---- 7. Create WebSocket client and message listener ---------------------
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

  // ---- 8. Create SisyphusPresence ------------------------------------------
  let presence: SisyphusPresence | null = null;
  if (wsClient.connected) {
    log.info("Creating SisyphusPresence");
    presence = new SisyphusPresence(wsClient);
    presence.broadcast();
    log.info("SisyphusPresence created and initial broadcast sent");
  } else {
    log.info("Skipping SisyphusPresence (WebSocket not connected)");
  }

  // ---- 9. Create DispatchCycle ---------------------------------------------
  log.info("Creating DispatchCycle");
  const dispatchCycle = new DispatchCycle(
    store,
    graph,
    eventQueue,
    messageListener,
    connections.redis,
  );
  log.info("DispatchCycle created");

  log.info("All services initialized successfully");

  return {
    store,
    syncer,
    graph,
    eventDetector,
    eventQueue,
    eventDispatcher,
    messageListener,
    presence,
    dispatchCycle,
  };
}
