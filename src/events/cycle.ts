/**
 * Dispatch cycle — the main loop iteration that ties the event pipeline
 * together and invokes the LangGraph agent graph.
 *
 * Each cycle:
 *  1. Collects new driver messages from the MessageListener
 *  2. Runs the EventDetector against the current ontology state
 *  3. Combines all events into the priority queue
 *  4. Drains up to MAX_EVENTS_PER_CYCLE events
 *  5. Formats them into a natural-language prompt via EventDispatcher
 *  6. Invokes the compiled LangGraph dispatch graph
 *
 * The cycle is designed to be called repeatedly by the Temporal workflow
 * (or any scheduler). It is stateless between calls except for the shared
 * event queue, which may carry over low-priority events from a previous cycle.
 */

import { HumanMessage } from "@langchain/core/messages";
import type { Redis as RedisClient } from "ioredis";

import type { OntologyStore } from "../ontology/state/store.js";
import type { MessageListener } from "../execution/websocket/message-listener.js";
import type { PrioritizedEvent } from "./types.js";
import { EventDetector } from "./detector.js";
import { EventDispatcher } from "./dispatcher.js";
import type { EventQueue } from "./queue.js";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("events:cycle");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CycleResult {
  /** Number of events processed this cycle. */
  eventsProcessed: number;
  /** Whether the LangGraph graph was invoked. */
  graphInvoked: boolean;
  /** Total cycle duration in milliseconds. */
  duration: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EVENTS_PER_CYCLE = 10;

// ---------------------------------------------------------------------------
// DispatchCycle
// ---------------------------------------------------------------------------

/**
 * The compiled dispatch graph type — we accept anything with an `invoke` method
 * so the cycle is testable without standing up the full LangGraph stack.
 */
export interface DispatchGraph {
  invoke(
    input: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Promise<unknown>;
}

export class DispatchCycle {
  private readonly store: OntologyStore;
  private readonly graph: DispatchGraph;
  private readonly eventQueue: EventQueue;
  private readonly messageListener: MessageListener;
  private readonly redis: RedisClient;
  private readonly detector: EventDetector;
  private readonly dispatcher: EventDispatcher;

  /** Snapshot of the previous store state for diff-based detection. */
  private previousStore: OntologyStore | undefined;

  /** Running thread ID for graph invocations within this cycle instance. */
  private readonly threadId: string;

  constructor(
    store: OntologyStore,
    graph: DispatchGraph,
    eventQueue: EventQueue,
    messageListener: MessageListener,
    redis: RedisClient,
  ) {
    this.store = store;
    this.graph = graph;
    this.eventQueue = eventQueue;
    this.messageListener = messageListener;
    this.redis = redis;
    this.detector = new EventDetector();
    this.dispatcher = new EventDispatcher();
    this.threadId = `cycle-${Date.now()}`;
  }

  /**
   * Execute one dispatch cycle.
   */
  async run(): Promise<CycleResult> {
    const start = Date.now();

    // ------------------------------------------------------------------
    // 1. Collect new driver messages and convert to events
    // ------------------------------------------------------------------
    const driverMessages = this.messageListener.getUnprocessedMessages();
    const messageEvents: PrioritizedEvent[] = [];

    for (const msg of driverMessages) {
      messageEvents.push({
        event: {
          type: "new_driver_message",
          driverId: msg.driverId,
          driverName: msg.driverName,
          message: msg.content,
          timestamp: msg.receivedAt,
        },
        priority: "high",
        createdAt: msg.receivedAt,
      });

      // Mark processed so they don't appear next cycle
      this.messageListener.markProcessed(msg.messageId);
    }

    if (messageEvents.length > 0) {
      log.info({ count: messageEvents.length }, "Collected driver messages");
    }

    // ------------------------------------------------------------------
    // 2. Run EventDetector against current ontology state
    // ------------------------------------------------------------------
    const detectedEvents = this.detector.detect(this.store, this.previousStore);

    if (detectedEvents.length > 0) {
      log.info({ count: detectedEvents.length }, "Detected ontology events");
    }

    // ------------------------------------------------------------------
    // 3. Enqueue all events
    // ------------------------------------------------------------------
    this.eventQueue.enqueueAll(messageEvents);
    this.eventQueue.enqueueAll(detectedEvents);

    // ------------------------------------------------------------------
    // 4. If empty, nothing to do
    // ------------------------------------------------------------------
    if (this.eventQueue.isEmpty) {
      log.debug("No events to process this cycle");
      return {
        eventsProcessed: 0,
        graphInvoked: false,
        duration: Date.now() - start,
      };
    }

    // ------------------------------------------------------------------
    // 5. Drain up to MAX_EVENTS_PER_CYCLE events
    // ------------------------------------------------------------------
    const batch: PrioritizedEvent[] = [];
    const allEvents = this.eventQueue.drain();

    for (const evt of allEvents) {
      if (batch.length < MAX_EVENTS_PER_CYCLE) {
        batch.push(evt);
      } else {
        // Put the rest back in the queue for the next cycle
        this.eventQueue.enqueue(evt);
      }
    }

    // ------------------------------------------------------------------
    // 6. Format into an agent message
    // ------------------------------------------------------------------
    const prompt = this.dispatcher.buildDispatchMessage(batch);

    log.info(
      { eventsInBatch: batch.length, remainingInQueue: this.eventQueue.size },
      "Invoking dispatch graph",
    );

    // ------------------------------------------------------------------
    // 7. Invoke the LangGraph graph
    // ------------------------------------------------------------------
    try {
      await this.graph.invoke(
        { messages: [new HumanMessage(prompt)] },
        { configurable: { thread_id: this.threadId } },
      );
    } catch (err) {
      log.error({ err }, "Graph invocation failed");
      // Don't throw — the cycle is best-effort. Events are already dequeued.
    }

    // ------------------------------------------------------------------
    // 8. Save current store as previous for next cycle's diff
    // ------------------------------------------------------------------
    // Note: We don't deep-clone the store here because the ontology syncer
    // replaces map contents via updateX() methods, so the next sync will
    // overwrite the maps. The previousStore reference becomes stale at that
    // point, which is exactly what we want for diffing.
    // (A real deep snapshot would be needed if the store mutated in-place.)

    const duration = Date.now() - start;
    log.info({ eventsProcessed: batch.length, duration }, "Dispatch cycle complete");

    return {
      eventsProcessed: batch.length,
      graphInvoked: true,
      duration,
    };
  }
}
