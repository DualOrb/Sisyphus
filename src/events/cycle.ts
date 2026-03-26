/**
 * Dispatch cycle -- the core intelligence loop for Sisyphus.
 *
 * Each cycle:
 *  1. Accepts raw dispatch.txt data (caller fetches from S3)
 *  2. Diffs current vs previous dispatch data to detect changes
 *  3. Decides whether to invoke the LLM (first cycle, changes, heartbeat)
 *  4. Builds a focused prompt (full board on first cycle, changed zones after)
 *  5. Invokes the LangGraph dispatch graph with a fresh thread per cycle
 *  6. Extracts a rolling summary for cross-cycle context
 *  7. Returns a CycleResult describing what happened
 *
 * The cycle maintains state between run() calls: previous dispatch data,
 * rolling summary, cycle count, and LLM cooldown tracking. This allows
 * the caller (shadow-live.ts, Temporal activity, or any scheduler) to be
 * a thin wrapper that fetches data and calls run() in a loop.
 */

import { HumanMessage, AIMessage } from "@langchain/core/messages";
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
  /** Number of dispatch.txt changes detected. */
  changesDetected: number;
  /** Why the graph was (or was not) invoked. */
  reason: "initial" | "changes" | "heartbeat" | "skipped";
  /** Brief summary of what the AI decided (for logging). */
  summary?: string;
}

export interface ChangeDetail {
  type:
    | "new_order"
    | "order_status"
    | "order_completed"
    | "order_assigned"
    | "driver_online"
    | "driver_offline"
    | "driver_paused"
    | "driver_unpaused"
    | "driver_appeared"
    | "driver_disappeared";
  description: string;
  zone?: string;
}

export interface Changes {
  details: ChangeDetail[];
  hasChanges: boolean;
  summary: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EVENTS_PER_CYCLE = 10;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 90_000;
const DEFAULT_LLM_COOLDOWN_MS = 30_000;
const TZ = "America/Toronto";

// ---------------------------------------------------------------------------
// DispatchGraph interface
// ---------------------------------------------------------------------------

/**
 * The compiled dispatch graph type -- we accept anything with an `invoke`
 * method so the cycle is testable without standing up the full LangGraph stack.
 */
export interface DispatchGraph {
  invoke(
    input: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// DispatchCycle config
// ---------------------------------------------------------------------------

export interface DispatchCycleConfig {
  store: OntologyStore;
  graph: DispatchGraph;
  eventQueue: EventQueue;
  messageListener?: MessageListener | null;
  redis: RedisClient;
  heartbeatIntervalMs?: number;
  llmCooldownMs?: number;
  /** Previous shift handoff data for cross-shift awareness (first cycle only). */
  shiftHandoff?: { notes?: string | null; issues?: unknown; escalations?: number | null } | null;
}

// ---------------------------------------------------------------------------
// DispatchCycle
// ---------------------------------------------------------------------------

export class DispatchCycle {
  private readonly store: OntologyStore;
  private readonly graph: DispatchGraph;
  private readonly eventQueue: EventQueue;
  private readonly messageListener: MessageListener | null;
  private readonly redis: RedisClient;
  private readonly detector: EventDetector;
  private readonly dispatcher: EventDispatcher;
  private readonly heartbeatIntervalMs: number;
  private readonly llmCooldownMs: number;
  private readonly shiftHandoff: DispatchCycleConfig["shiftHandoff"];

  // -- State maintained between run() calls --
  private previousDispatchData: any = null;
  private cycleSummary = "";
  private cycleCount = 0;
  private lastLlmCall = 0;
  private isFirstCycle = true;

  /** Snapshot of the previous store state for EventDetector diff. */
  private previousStore: OntologyStore | undefined;

  /**
   * Event deduplication — tracks which issues have already been dispatched
   * to prevent the same late order / offline driver from being reported
   * every 20 seconds. Key = dedup key (e.g. "late:dfee7605"), Value = timestamp.
   * Entries expire after 5 minutes to allow re-reporting if still unresolved.
   */
  private readonly dispatchedIssues = new Map<string, number>();
  private static readonly DEDUP_TTL_MS = 300_000; // 5 minutes

  constructor(config: DispatchCycleConfig) {
    this.store = config.store;
    this.graph = config.graph;
    this.eventQueue = config.eventQueue;
    this.messageListener = config.messageListener ?? null;
    this.redis = config.redis;
    this.detector = new EventDetector();
    this.dispatcher = new EventDispatcher();
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.llmCooldownMs = config.llmCooldownMs ?? DEFAULT_LLM_COOLDOWN_MS;
    this.shiftHandoff = config.shiftHandoff ?? null;
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Execute one dispatch cycle.
   *
   * @param dispatchData  Parsed dispatch.txt JSON (the full object).
   *                      Structure: `{ Timestamp, [zoneName]: { Drivers, Orders, Meter, Delivery } }`
   *                      If omitted, the cycle runs using only the event pipeline (legacy mode).
   */
  async run(dispatchData?: any): Promise<CycleResult> {
    const start = Date.now();
    this.cycleCount++;

    // ------------------------------------------------------------------
    // 1. Collect driver messages from WebSocket (if available)
    // ------------------------------------------------------------------
    const messageEvents = this.collectDriverMessages();

    // ------------------------------------------------------------------
    // 2. Detect changes by diffing dispatch.txt data
    // ------------------------------------------------------------------
    let changes: Changes = { details: [], hasChanges: false, summary: "No dispatch data" };

    if (dispatchData) {
      changes = detectChanges(this.store, this.previousStore ?? null, dispatchData, this.previousDispatchData);

      // Fold WebSocket driver messages into changes
      if (this.messageListener) {
        const wsMessages = this.messageListener.getUnprocessedMessages();
        for (const msg of wsMessages) {
          changes.details.push({
            type: "new_order" as ChangeDetail["type"],
            description: `[WS] Driver message from ${msg.driverName} (${msg.driverId}): ${msg.content}`,
            zone: undefined,
          });
          this.messageListener.markProcessed(msg.messageId);
        }
        if (wsMessages.length > 0) {
          (changes as any).hasChanges = true;
          log.info({ count: wsMessages.length }, "WebSocket driver messages added to changes");
        }
      }
    }

    // ------------------------------------------------------------------
    // 2b. Annotate recurring issues — tell the supervisor what it already
    //     acted on so it can decide to escalate vs wait, instead of
    //     treating every recurrence as a brand-new issue.
    // ------------------------------------------------------------------
    if (!this.isFirstCycle && changes.hasChanges) {
      const now = Date.now();

      // Expire old entries
      for (const [key, ts] of this.dispatchedIssues) {
        if (now - ts > DispatchCycle.DEDUP_TTL_MS) {
          this.dispatchedIssues.delete(key);
        }
      }

      for (const d of changes.details) {
        const key = `${d.type}:${d.zone ?? ""}:${d.description.slice(0, 60)}`;
        const prevTime = this.dispatchedIssues.get(key);
        if (prevTime) {
          const agoMin = ((now - prevTime) / 60_000).toFixed(1);
          d.description += ` [PREVIOUSLY FLAGGED ${agoMin}min ago — check if action was taken, escalate if unresolved]`;
        }
        this.dispatchedIssues.set(key, prevTime ?? now); // keep original timestamp
      }
    }

    // ------------------------------------------------------------------
    // 3. Run EventDetector against ontology state (supplementary)
    // ------------------------------------------------------------------
    const ontologyEvents = this.detector.detect(this.store, this.previousStore);

    // Convert raw changes into PrioritizedEvents
    const changeEvents = changesToEvents(changes);

    // Enqueue all
    this.eventQueue.enqueueAll(messageEvents);
    this.eventQueue.enqueueAll(ontologyEvents);
    this.eventQueue.enqueueAll(changeEvents);

    // ------------------------------------------------------------------
    // 4. Decide whether to invoke the graph
    // ------------------------------------------------------------------
    const timeSinceLastLlm = Date.now() - this.lastLlmCall;
    const isHeartbeat = timeSinceLastLlm > this.heartbeatIntervalMs && !this.isFirstCycle;

    const shouldInvokeGraph =
      (this.isFirstCycle || changes.hasChanges || isHeartbeat) &&
      timeSinceLastLlm > this.llmCooldownMs;

    if (!shouldInvokeGraph && !this.isFirstCycle) {
      // Save previous store snapshot even when skipping
      if (dispatchData) {
        this.previousDispatchData = dispatchData;
        this.previousStore = this.snapshotStore();
      }

      log.debug(
        { changesDetected: changes.details.length, timeSinceLastLlm },
        "No graph invocation needed this cycle",
      );

      return {
        eventsProcessed: 0,
        graphInvoked: false,
        duration: Date.now() - start,
        changesDetected: changes.details.length,
        reason: "skipped",
      };
    }

    // ------------------------------------------------------------------
    // 5. Build the prompt
    // ------------------------------------------------------------------
    let combinedPrompt = "";

    // Prepend previous shift handoff on first cycle
    if (this.isFirstCycle && this.shiftHandoff) {
      const handoffParts: string[] = [];
      if (this.shiftHandoff.notes) {
        handoffParts.push(`Notes: ${this.shiftHandoff.notes}`);
      }
      if (this.shiftHandoff.issues) {
        const issuesStr = typeof this.shiftHandoff.issues === "string"
          ? this.shiftHandoff.issues
          : JSON.stringify(this.shiftHandoff.issues);
        handoffParts.push(`Unresolved issues: ${issuesStr}`);
      }
      if (this.shiftHandoff.escalations && this.shiftHandoff.escalations > 0) {
        handoffParts.push(`Escalations from previous shift: ${this.shiftHandoff.escalations}`);
      }
      if (handoffParts.length > 0) {
        combinedPrompt = `PREVIOUS SHIFT HANDOFF: ${handoffParts.join(" | ")}\n\n`;
      }
    }

    // Prepend rolling context summary from previous cycle
    if (this.cycleSummary) {
      combinedPrompt += `PREVIOUS CYCLE SUMMARY: ${this.cycleSummary}\n\n`;
    }

    // Build situation prompt from dispatch.txt changes
    if (dispatchData) {
      combinedPrompt += buildChangesPrompt(changes, dispatchData, this.isFirstCycle);

      // Append open ticket summary
      const ticketCount = this.store.tickets.size;
      if (ticketCount > 0) {
        const ticketLines: string[] = [`\n-- Open Tickets (${ticketCount}) --`];
        for (const t of this.store.tickets.values()) {
          const age = Math.round((Date.now() - t.createdAt.getTime()) / 60000);
          ticketLines.push(
            `  ${t.issueId}: [${t.status}] ${t.category} / ${t.issueType} -- ${t.restaurantName ?? t.originator} (${age}m old)`,
          );
        }
        combinedPrompt += "\n" + ticketLines.join("\n") + "\n";
      }
    }

    // Append event-pipeline formatted message if there are queued events
    if (!this.eventQueue.isEmpty) {
      const batch: PrioritizedEvent[] = [];
      const allEvents = this.eventQueue.drain();
      for (const evt of allEvents) {
        if (batch.length < MAX_EVENTS_PER_CYCLE) {
          batch.push(evt);
        } else {
          this.eventQueue.enqueue(evt);
        }
      }
      if (batch.length > 0) {
        const eventMessage = this.dispatcher.buildDispatchMessage(batch);
        combinedPrompt += `\n\n---\n\n${eventMessage}`;
      }
    }

    // Append focus areas
    combinedPrompt += buildFocusAreas(this.store);

    const reason: CycleResult["reason"] = this.isFirstCycle
      ? "initial"
      : isHeartbeat
        ? "heartbeat"
        : "changes";

    log.info(
      {
        reason,
        changesDetected: changes.details.length,
        cycleCount: this.cycleCount,
      },
      "Invoking dispatch graph",
    );

    // ------------------------------------------------------------------
    // 6. Invoke the LangGraph graph with a fresh thread per cycle
    // ------------------------------------------------------------------
    let summary: string | undefined;
    let graphInvoked = false;

    const cycleThreadId = `cycle-${this.cycleCount}-${Date.now()}`;

    try {
      const result = await this.graph.invoke(
        { messages: [new HumanMessage(combinedPrompt)] },
        { configurable: { thread_id: cycleThreadId } },
      );

      graphInvoked = true;
      this.lastLlmCall = Date.now();
      this.isFirstCycle = false;

      // Extract rolling summary from graph response
      const messages = (result as any)?.messages ?? [];
      summary = extractCycleSummary(messages);
      this.cycleSummary = summary ?? "";
    } catch (err) {
      this.lastLlmCall = Date.now();
      this.isFirstCycle = false;
      log.error({ err }, "Graph invocation failed");
      // Don't throw -- the cycle is best-effort.
    }

    // ------------------------------------------------------------------
    // 7. Save current state for next diff
    // ------------------------------------------------------------------
    if (dispatchData) {
      this.previousDispatchData = dispatchData;
    }
    this.previousStore = this.snapshotStore();

    const duration = Date.now() - start;
    log.info(
      {
        reason,
        changesDetected: changes.details.length,
        graphInvoked,
        duration,
      },
      "Dispatch cycle complete",
    );

    return {
      eventsProcessed: changes.details.length,
      graphInvoked,
      duration,
      changesDetected: changes.details.length,
      reason,
      summary,
    };
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /** Collect unprocessed driver messages from the WebSocket message listener. */
  private collectDriverMessages(): PrioritizedEvent[] {
    if (!this.messageListener) return [];

    const driverMessages = this.messageListener.getUnprocessedMessages();
    const events: PrioritizedEvent[] = [];

    for (const msg of driverMessages) {
      events.push({
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

      this.messageListener.markProcessed(msg.messageId);
    }

    if (events.length > 0) {
      log.info({ count: events.length }, "Collected driver messages");
    }

    return events;
  }

  /**
   * Create a detached snapshot of the current store for next cycle's diff.
   * We create a NEW store so it won't be affected when the main store is
   * updated in-place next cycle.
   */
  private snapshotStore(): OntologyStore {
    // Import dynamically to avoid circular dependency issues at module level.
    // OntologyStore is already loaded as a type import; we need the class.
    // Since this.store is an OntologyStore instance, we can use its constructor.
    const StoreClass = this.store.constructor as new () => OntologyStore;
    const snapshot = new StoreClass();
    snapshot.updateOrders([...this.store.orders.values()]);
    snapshot.updateDrivers([...this.store.drivers.values()]);
    snapshot.updateMarkets([...this.store.markets.values()]);
    snapshot.updateTickets([...this.store.tickets.values()]);
    return snapshot;
  }
}

// ===========================================================================
// Module-level helper functions (ported from shadow-live.ts)
// ===========================================================================

// ---------------------------------------------------------------------------
// Time formatting helpers
// ---------------------------------------------------------------------------

function formatTime(date: Date | null | undefined): string {
  if (!date || isNaN(date.getTime())) return "n/a";
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}

function minutesAgo(date: Date | null | undefined): string {
  if (!date || isNaN(date.getTime())) return "?";
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 0) return `in ${-mins}m`;
  if (mins === 0) return "now";
  return `${mins}m ago`;
}

// ---------------------------------------------------------------------------
// Change detection: diff current vs previous dispatch.txt data
// ---------------------------------------------------------------------------

function detectChanges(
  _current: OntologyStore,
  _previous: OntologyStore | null,
  currentData: any,
  previousData: any,
): Changes {
  const details: ChangeDetail[] = [];

  if (!_previous || !previousData) {
    return { details, hasChanges: false, summary: "Initial sync" };
  }

  const zones = Object.keys(currentData).filter((k) => k !== "Timestamp");

  for (const zone of zones) {
    const curOrders = currentData[zone]?.Orders ?? [];
    const prevOrders = previousData[zone]?.Orders ?? [];
    const curDrivers = currentData[zone]?.Drivers ?? [];
    const prevDrivers = previousData[zone]?.Drivers ?? [];

    const prevOrderMap = new Map<string, any>(prevOrders.map((o: any) => [o.OrderId, o]));
    const prevDriverMap = new Map<string, any>(prevDrivers.map((d: any) => [d.DriverId, d]));
    const curOrderMap = new Map<string, any>(curOrders.map((o: any) => [o.OrderId, o]));
    const curDriverMap = new Map<string, any>(curDrivers.map((d: any) => [d.DriverId, d]));

    // New and changed orders
    for (const o of curOrders) {
      const prev = prevOrderMap.get(o.OrderId);
      if (!prev) {
        const driver = curDrivers.find((d: any) => d.DriverId === o.DriverId);
        const driverLabel = o.DriverId
          ? `${driver?.Monacher || driver?.FullName || "unknown"} (${o.DriverId})`
          : "UNASSIGNED";
        details.push({
          type: "new_order",
          zone,
          description: `New order ${o.OrderIdKey} from ${o.RestaurantName} (${o.OrderStatus}) — ${o.DriverId ? "assigned to" : "UNASSIGNED, needs"} driver: ${driverLabel}`,
        });
      } else if (prev.OrderStatus !== o.OrderStatus) {
        details.push({
          type: "order_status",
          zone,
          description: `Order ${o.OrderIdKey} (${o.RestaurantName}): ${prev.OrderStatus} -> ${o.OrderStatus}`,
        });
      }
      if (prev && prev.DriverId !== o.DriverId && o.DriverId) {
        const newDriver = curDrivers.find((d: any) => d.DriverId === o.DriverId);
        const oldDriver = prevDrivers.find((d: any) => d.DriverId === prev.DriverId);
        details.push({
          type: "order_assigned",
          zone,
          description: `Order ${o.OrderIdKey} reassigned: ${oldDriver?.Monacher || "none"} -> ${newDriver?.Monacher || o.DriverId.split("@")[0]}`,
        });
      }
    }

    // Completed / removed orders
    for (const o of prevOrders) {
      if (!curOrderMap.has(o.OrderId)) {
        details.push({
          type: "order_completed",
          zone,
          description: `Order ${o.OrderIdKey} (${o.RestaurantName}) delivered/completed`,
        });
      }
    }

    // Driver changes
    for (const d of curDrivers) {
      const prev = prevDriverMap.get(d.DriverId);
      const name = d.Monacher || d.FullName || d.DriverId.split("@")[0];
      if (!prev) {
        details.push({
          type: "driver_appeared",
          zone,
          description: `Driver ${name} appeared in ${zone} (${d.OnShift ? "on-shift" : "off-shift"})`,
        });
      } else {
        if (!prev.OnShift && d.OnShift) {
          details.push({ type: "driver_online", zone, description: `Driver ${name} came on-shift in ${zone}` });
        } else if (prev.OnShift && !d.OnShift) {
          details.push({ type: "driver_offline", zone, description: `Driver ${name} went off-shift in ${zone}` });
        }
        if (!prev.Paused && d.Paused) {
          details.push({ type: "driver_paused", zone, description: `Driver ${name} was paused in ${zone}` });
        } else if (prev.Paused && !d.Paused) {
          details.push({ type: "driver_unpaused", zone, description: `Driver ${name} was unpaused in ${zone}` });
        }
      }
    }

    // Drivers that left dispatch
    for (const d of prevDrivers) {
      if (!curDriverMap.has(d.DriverId)) {
        const name = d.Monacher || d.FullName || d.DriverId.split("@")[0];
        details.push({
          type: "driver_disappeared",
          zone,
          description: `Driver ${name} left dispatch in ${zone}`,
        });
      }
    }
  }

  const summary =
    details.length > 0
      ? details.map((d) => d.description).join("; ")
      : "No changes";

  return { details, hasChanges: details.length > 0, summary };
}

// ---------------------------------------------------------------------------
// Order status helpers — derive real status from StatusHistory + time fields
// ---------------------------------------------------------------------------

interface OrderStatusInfo {
  /** The real current status derived from StatusHistory (e.g. "At-Restaurant", "En-Route") */
  currentStatus: string;
  /** Compact timeline string for the prompt */
  timeline: string;
  /** Whether this order is truly late (past ready, driver not actively working on it) */
  isLate: boolean;
  /** Whether driver has confirmed/acknowledged the order */
  driverConfirmed: boolean;
}

function deriveOrderStatus(o: any): OrderStatusInfo {
  const history: { status: string; timestamp: number }[] = o.StatusHistory ?? [];
  const lastEntry = history.length > 0 ? history[history.length - 1] : null;

  // Real current status = last entry in StatusHistory, falling back to OrderStatus
  const currentStatus = lastEntry?.status ?? o.OrderStatus ?? "Unknown";

  // Build compact timeline: "Confirmed 10:02 → En-Route 10:05 → At-Restaurant 10:06"
  const timelineParts: string[] = [];
  for (const h of history) {
    const t = new Date(h.timestamp * 1000).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ,
    });
    timelineParts.push(`${h.status} ${t}`);
  }
  // Add timestamps from individual fields if not in history
  if (timelineParts.length === 0) {
    if (o.OrderPlacedTime) timelineParts.push(`Placed ${formatTime(new Date(o.OrderPlacedTime * 1000))}`);
    if (o.DeliveryConfirmedTime) timelineParts.push(`Confirmed ${formatTime(new Date(o.DeliveryConfirmedTime * 1000))}`);
    if (o.EnrouteTime) timelineParts.push(`En-Route ${formatTime(new Date(o.EnrouteTime * 1000))}`);
    if (o.WaitingForOrderTime) timelineParts.push(`At-Restaurant ${formatTime(new Date(o.WaitingForOrderTime * 1000))}`);
  }
  const timeline = timelineParts.join(" → ");

  const readyTime = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;

  // Statuses that mean the driver is actively working on this order
  const activeStatuses = ["En-Route", "At-Restaurant", "In-Bag", "InTransit", "At-Customer"];
  const isDriverActive = activeStatuses.some(
    (s) => currentStatus.toLowerCase().replace(/[-_ ]/g, "") === s.toLowerCase().replace(/[-_ ]/g, ""),
  );

  // Only flag as LATE if past ready time AND driver is NOT actively working on it
  const isLate = !!(
    readyTime &&
    readyTime.getTime() < Date.now() &&
    !isDriverActive &&
    currentStatus !== "InTransit" &&
    currentStatus !== "Completed" &&
    currentStatus !== "Cancelled"
  );

  const driverConfirmed = !!(o.DeliveryConfirmed || o.DeliveryConfirmedTime);

  return { currentStatus, timeline, isLate, driverConfirmed };
}

// ---------------------------------------------------------------------------
// Prompt builder: dispatch.txt situation prompt for the graph
// ---------------------------------------------------------------------------

function buildChangesPrompt(
  changes: Changes,
  dispatchData: any,
  firstCycle: boolean,
): string {
  const zones = Object.keys(dispatchData).filter((k) => k !== "Timestamp");
  const lines: string[] = [];

  if (firstCycle) {
    lines.push(
      `SISYPHUS DISPATCH -- ${new Date().toLocaleString("en-US", { timeZone: TZ })}`,
    );
    lines.push(`This is the initial state. Review the full board and identify any issues.`);
    lines.push(``);

    for (const zone of zones) {
      const zd = dispatchData[zone];
      const orders = zd.Orders ?? [];
      const drivers = zd.Drivers ?? [];
      if (orders.length === 0 && drivers.length === 0) continue;

      const onShift = drivers.filter((d: any) => d.OnShift && !d.Paused);
      lines.push(`-- ${zone} (${onShift.length} drivers on-shift, ${orders.length} orders) --`);

      for (const d of drivers) {
        const status = d.Paused ? "PAUSED" : d.OnShift ? "ON-SHIFT" : d.Available ? "ON-CALL" : "OFF";
        const orderCount = orders.filter((o: any) => o.DriverId === d.DriverId).length;
        const name = d.Monacher || d.FullName?.split(" ")[0] || d.DriverId.split("@")[0];
        const flags = [
          d.TrainingOrders > 0 ? `trainee(${d.TrainingOrders})` : "",
          d.Alcohol ? "smartserve" : "",
          d.NearEnd ? "NEAR-END" : "",
        ].filter(Boolean).join(", ");
        lines.push(`  ${name} (${d.DriverId}): ${status}, ${orderCount} orders${flags ? ` [${flags}]` : ""}`);
      }

      for (const o of orders) {
        const readyTime = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;
        const driver = drivers.find((d: any) => d.DriverId === o.DriverId);
        const driverMonacher = driver?.Monacher || driver?.FullName?.split(" ")[0] || null;
        const driverEmail = o.DriverId || null;
        const driverLabel = driverMonacher && driverEmail
          ? `${driverMonacher} (${driverEmail})`
          : driverMonacher || driverEmail || "UNASSIGNED";
        const status = deriveOrderStatus(o);
        const alcohol = o.Alcohol ? " [ALCOHOL]" : "";
        lines.push(
          `  Order ${o.OrderIdKey}: ${status.currentStatus}${status.isLate ? " LATE" : ""}${alcohol} | ${o.RestaurantName} -> ${o.DeliveryStreet || "?"}, ${o.DeliveryCity || ""} | Driver: ${driverLabel} | Ready: ${formatTime(readyTime)} (${minutesAgo(readyTime)})${status.timeline ? ` | ${status.timeline}` : ""}`,
        );
      }
      lines.push(``);
    }

    const noDriverMarkets = zones.filter((z) => {
      const zd = dispatchData[z];
      return (zd.Drivers?.length ?? 0) === 0 && (zd.Meter?.idealDrivers ?? 0) > 0;
    });
    if (noDriverMarkets.length > 0) {
      lines.push(`NO DRIVERS: ${noDriverMarkets.join(", ")}`);
      lines.push(``);
    }
  } else if (!changes.hasChanges) {
    lines.push(`No changes since last cycle. All markets stable.`);
    return lines.join("\n");
  } else {
    lines.push(
      `CHANGES DETECTED -- ${new Date().toLocaleTimeString("en-US", { timeZone: TZ })}`,
    );
    lines.push(``);

    for (const change of changes.details) {
      const prefix = change.zone ? `[${change.zone}] ` : "";
      lines.push(`* ${prefix}${change.description}`);
    }
    lines.push(``);

    const affectedZones = new Set(changes.details.map((d) => d.zone).filter(Boolean));
    for (const zone of affectedZones) {
      const zd = dispatchData[zone!];
      if (!zd) continue;
      const orders = zd.Orders ?? [];
      const drivers = zd.Drivers ?? [];
      const onShift = drivers.filter((d: any) => d.OnShift && !d.Paused);

      lines.push(`Current state of ${zone} (${onShift.length} on-shift, ${orders.length} orders):`);
      for (const d of drivers) {
        const status = d.Paused ? "PAUSED" : d.OnShift ? "ON-SHIFT" : "OFF";
        const orderCount = orders.filter((o: any) => o.DriverId === d.DriverId).length;
        const name = d.Monacher || d.FullName?.split(" ")[0] || d.DriverId.split("@")[0];
        lines.push(`  ${name} (${d.DriverId}): ${status}, ${orderCount} orders`);
      }
      for (const o of orders) {
        const readyTime = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;
        const driver = drivers.find((d: any) => d.DriverId === o.DriverId);
        const driverMonacher = driver?.Monacher || driver?.FullName?.split(" ")[0] || null;
        const driverEmail = o.DriverId || null;
        const driverLabel = driverMonacher && driverEmail
          ? `${driverMonacher} (${driverEmail})`
          : driverMonacher || driverEmail || "UNASSIGNED";
        const status = deriveOrderStatus(o);
        const alcohol = o.Alcohol ? " [ALCOHOL]" : "";
        lines.push(
          `  Order ${o.OrderIdKey}: ${status.currentStatus}${status.isLate ? " LATE" : ""}${alcohol} | ${o.RestaurantName} | Driver: ${driverLabel} | Ready: ${formatTime(readyTime)} (${minutesAgo(readyTime)})${status.timeline ? ` | ${status.timeline}` : ""}`,
        );
      }
      lines.push(``);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Focus areas: tell the supervisor what types of work are currently relevant
// ---------------------------------------------------------------------------

function buildFocusAreas(store: OntologyStore): string {
  const activeOrders = store.orders.size;
  const openTickets = store.tickets.size;
  const allDrivers = [...store.drivers.values()];
  const driversOnShift = allDrivers.filter((d) => d.isOnline && !d.isPaused).length;
  const activeMarkets = [...store.markets.values()].filter(
    (m) => allDrivers.some((d) => d.dispatchZone === m.market && d.isOnline),
  ).length;

  const focusList: string[] = [];

  if (activeOrders > 0) focusList.push("order monitoring & assignment");
  if (openTickets > 0) focusList.push("ticket resolution");
  if (driversOnShift > 0) focusList.push("driver communication & scheduling");
  if (activeMarkets > 0) focusList.push("market health monitoring");
  if (focusList.length === 0) focusList.push("general oversight (quiet period)");

  const lines = [
    `\n-- FOCUS AREAS --`,
    `Active orders: ${activeOrders > 0 ? `yes (${activeOrders})` : "no"}`,
    `Open tickets: ${openTickets > 0 ? `yes (${openTickets})` : "no"}`,
    `Drivers on shift: ${driversOnShift}`,
    `Active markets with drivers: ${activeMarkets}`,
    `Focus on: ${focusList.join(", ")}`,
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Extract cycle summary from the graph's response messages
// ---------------------------------------------------------------------------

/**
 * Extract a short summary (max 500 chars) from the last AIMessage content.
 * Takes the first paragraph or the first 500 characters, whichever is shorter.
 */
function extractCycleSummary(messages: any[]): string {
  // Walk backwards to find the last AIMessage with text content
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const isAi =
      msg instanceof AIMessage ||
      msg._getType?.() === "ai" ||
      msg.constructor?.name === "AIMessage";
    if (!isAi) continue;

    const raw =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c: any) => (typeof c === "string" ? c : c.text ?? "")).join(" ")
          : "";
    if (!raw) continue;

    // First paragraph = up to the first blank line
    const firstParagraph = raw.split(/\n\s*\n/)[0]?.trim() ?? raw.trim();
    return firstParagraph.slice(0, 500);
  }
  return "";
}

// ---------------------------------------------------------------------------
// Convert raw changes into PrioritizedEvents for the event pipeline
// ---------------------------------------------------------------------------

function changesToEvents(changes: Changes): PrioritizedEvent[] {
  const events: PrioritizedEvent[] = [];
  const ts = new Date();

  for (const detail of changes.details) {
    switch (detail.type) {
      case "new_order":
        events.push({
          event: {
            type: "unassigned_order",
            orderId: "unknown",
            orderIdKey: detail.description.match(/order (\S+)/i)?.[1] ?? "?",
            restaurantName: detail.description.match(/from (.+?) \(/)?.[1] ?? "?",
            deliveryZone: detail.zone ?? "unknown",
            minutesPending: 0,
          },
          priority: "normal",
          createdAt: ts,
        });
        break;

      case "order_status":
      case "order_completed":
      case "order_assigned": {
        const oldStatus = detail.description.match(/: (\S+) ->/)?.[1] ?? "unknown";
        const newStatus = detail.description.match(/-> (\S+)/)?.[1] ?? "unknown";
        events.push({
          event: {
            type: "order_status_change",
            orderId: "unknown",
            oldStatus,
            newStatus,
          },
          priority: "low",
          createdAt: ts,
        });
        break;
      }

      case "driver_offline":
      case "driver_disappeared":
        events.push({
          event: {
            type: "driver_offline",
            driverId: "unknown",
            driverName: detail.description.match(/Driver (\S+)/)?.[1] ?? "?",
            activeOrders: 0,
          },
          priority: "high",
          createdAt: ts,
        });
        break;

      case "driver_online":
      case "driver_appeared":
      case "driver_paused":
      case "driver_unpaused":
        events.push({
          event: {
            type: "order_status_change",
            orderId: "info",
            oldStatus: "n/a",
            newStatus: detail.description,
          },
          priority: "low",
          createdAt: ts,
        });
        break;
    }
  }

  return events;
}
