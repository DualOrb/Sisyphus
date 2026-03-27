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
import { CallbackHandler } from "@langfuse/langchain";
import { propagateAttributes } from "@langfuse/tracing";

import type { OntologyStore } from "../ontology/state/store.js";
import type { MessageListener } from "../execution/websocket/message-listener.js";
import type { PrioritizedEvent } from "./types.js";
import { EventDetector } from "./detector.js";
import { EventDispatcher } from "./dispatcher.js";
import type { EventQueue } from "./queue.js";
import { createChildLogger } from "../lib/logger.js";
import {
  ActionLedger,
  mapActionToKind,
  guessEntityTypeFromAction,
  extractEntityId,
  buildEntrySummary,
  needsFollowUp,
  FOLLOW_UP_INTERVAL_MS,
} from "./action-ledger.js";

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
  /** Shift-scoped ID for trace grouping and correlation. */
  shiftId?: string;
  /** Operating mode tag for trace filtering (shadow, supervised, autonomous). */
  operatingMode?: string;
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
  private readonly shiftId: string;
  private readonly operatingMode: string;

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

  /**
   * Rolling action ledger — accumulates everything the AI system has done
   * across cycles. Rendered into the supervisor prompt so it can reason
   * about what's already happened and what follow-ups are pending.
   */
  private readonly ledger: ActionLedger;

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
    this.shiftId = config.shiftId ?? "unknown";
    this.operatingMode = config.operatingMode ?? "shadow";
    this.ledger = new ActionLedger();
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

    // Append rolling action ledger — everything the AI has done recently
    if (!this.isFirstCycle) {
      const ledgerSection = this.ledger.renderForPrompt();
      if (ledgerSection) {
        combinedPrompt += ledgerSection + "\n";
      }
    }

    // Build situation prompt from dispatch.txt changes
    if (dispatchData) {
      combinedPrompt += buildChangesPrompt(changes, dispatchData, this.isFirstCycle);

      // Append open ticket summary — annotate tickets already dispatched
      const ticketCount = this.store.tickets.size;
      if (ticketCount > 0) {
        const ticketLines: string[] = [`\n-- Open Tickets (${ticketCount}) --`];
        for (const t of this.store.tickets.values()) {
          const age = Math.round((Date.now() - t.createdAt.getTime()) / 60000);
          const alreadyHandled = this.dispatchedIssues.has(`ticket:${t.issueId}`);
          const annotation = alreadyHandled
            ? " [ALREADY DISPATCHED — do NOT re-dispatch unless status changed]"
            : "";
          const ownerLabel = t.owner === "Unassigned" ? "UNASSIGNED" : `owner: ${t.owner}`;
          const orderRef = t.orderIdKey ? ` | order: ${t.orderIdKey}` : "";
          ticketLines.push(
            `  ticket ${t.issueId}: [${t.status}] [${ownerLabel}] ${t.category} / ${t.issueType} -- ${t.restaurantName ?? t.originator}${orderRef} (${age}m old)${annotation}`,
          );
          // Mark as dispatched so next cycle annotates it
          if (!alreadyHandled) {
            this.dispatchedIssues.set(`ticket:${t.issueId}`, Date.now());
          }
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
    const langfuseHandler = new CallbackHandler();

    try {
      const result = await propagateAttributes(
        {
          traceName: `Cycle #${this.cycleCount} - ${reason}`,
          sessionId: `shift-${this.shiftId}`,
          tags: ["dispatch-cycle", reason, this.operatingMode],
          metadata: {
            cycleNumber: String(this.cycleCount),
            shiftId: this.shiftId,
            reason,
            changesDetected: String(changes.details.length),
            operatingMode: this.operatingMode,
          },
        },
        () =>
          this.graph.invoke(
            { messages: [new HumanMessage(combinedPrompt)] },
            {
              configurable: { thread_id: cycleThreadId },
              callbacks: [langfuseHandler],
            },
          ),
      );

      graphInvoked = true;
      this.lastLlmCall = Date.now();
      this.isFirstCycle = false;

      // Extract rolling summary from graph response
      const messages = (result as any)?.messages ?? [];
      summary = extractCycleSummary(messages);
      this.cycleSummary = summary ?? "";

      // Record actions into the rolling ledger.
      // We need to correlate AIMessage tool_calls (which have the action name/params)
      // with ToolMessage results (which have the outcome). Build a map of
      // tool_call_id → args from AIMessages, then match with ToolMessage results.
      this.ledger.prune();
      const nowMs = Date.now();

      // Step 1: Index all execute_action tool call args by their call ID
      const toolCallArgs = new Map<string, { actionName: string; params: Record<string, any>; reasoning: string }>();
      for (const msg of messages) {
        if (msg.constructor?.name !== "AIMessage") continue;
        const aiMsg = msg as AIMessage;
        const calls = aiMsg.tool_calls ?? [];
        for (const tc of calls) {
          if (tc.name === "execute_action" && tc.id) {
            toolCallArgs.set(tc.id, {
              actionName: (tc.args as any)?.actionName ?? "unknown",
              params: (tc.args as any)?.params ?? {},
              reasoning: (tc.args as any)?.reasoning ?? "",
            });
          }
        }
      }

      // Step 2: Walk ToolMessages and correlate with the call args
      for (const msg of messages) {
        if (msg.constructor?.name !== "ToolMessage") continue;
        const content = typeof (msg as any).content === "string" ? (msg as any).content : "";
        const toolName = (msg as any).name;
        const toolCallId = (msg as any).tool_call_id;

        if (toolName !== "execute_action") continue;

        try {
          const result = JSON.parse(content);
          const outcome = result.outcome ?? (result.skipped ? "skipped" : "unknown");

          // Get the original call args for full context
          const callArgs = toolCallId ? toolCallArgs.get(toolCallId) : undefined;
          const actionType = callArgs?.actionName ?? result.actionType ?? "unknown";
          const params = callArgs?.params ?? result.params ?? {};
          const reasoning = callArgs?.reasoning ?? result.reasoning ?? "";

          // Build a merged object for the summary builder
          const merged = { actionType, outcome, params, reasoning, ...result };
          const entityId = extractEntityId(merged);

          this.ledger.record({
            ts: nowMs,
            kind: mapActionToKind(actionType, outcome),
            action: actionType,
            entityId,
            entityType: guessEntityTypeFromAction(actionType),
            summary: buildEntrySummary(merged),
            outcome,
            followUpAt: needsFollowUp(actionType, outcome) ? nowMs + FOLLOW_UP_INTERVAL_MS : undefined,
            cycleNumber: this.cycleCount,
          });
        } catch {
          // Not JSON or unparseable — skip
        }
      }
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
      if ((o.OrderType ?? "Delivery") === "Takeout") continue;
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
          // Only flag if driver has orders that are NOT InTransit/InBag
          // (InTransit = driver is finishing their last delivery, which is normal end-of-shift)
          const driverOrders = curOrders.filter((o: any) => o.DriverId === d.DriverId);
          const needsAttention = driverOrders.filter((o: any) => {
            const status = deriveOrderStatus(o);
            const activeDelivery = ["intransit", "inbag", "at-customer", "atcustomer"]
              .includes(status.currentStatus.toLowerCase().replace(/[-_ ]/g, ""));
            return !activeDelivery;
          });
          if (needsAttention.length > 0) {
            details.push({ type: "driver_offline", zone, description: `Driver ${name} (${d.DriverId}) went off-shift in ${zone} WITH ${needsAttention.length} order(s) not yet picked up` });
          }
          // Otherwise: driver finishing InTransit deliveries after shift = normal
        }
        if (!prev.Paused && d.Paused) {
          details.push({ type: "driver_paused", zone, description: `Driver ${name} was paused in ${zone}` });
        } else if (prev.Paused && !d.Paused) {
          details.push({ type: "driver_unpaused", zone, description: `Driver ${name} was unpaused in ${zone}` });
        }
      }
    }

    // Drivers that left dispatch — only flag if they had orders not yet picked up
    for (const d of prevDrivers) {
      if (!curDriverMap.has(d.DriverId)) {
        const driverOrders = curOrders.filter((o: any) => o.DriverId === d.DriverId);
        const needsAttention = driverOrders.filter((o: any) => {
          const status = deriveOrderStatus(o);
          const activeDelivery = ["intransit", "inbag", "at-customer", "atcustomer"]
            .includes(status.currentStatus.toLowerCase().replace(/[-_ ]/g, ""));
          return !activeDelivery;
        });
        if (needsAttention.length > 0) {
          const name = d.Monacher || d.FullName || d.DriverId.split("@")[0];
          details.push({
            type: "driver_disappeared",
            zone,
            description: `Driver ${name} (${d.DriverId}) left dispatch in ${zone} WITH ${needsAttention.length} order(s) not yet picked up`,
          });
        }
        // Otherwise: driver leaving dispatch with 0 orders is normal, no event needed
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

  // Only flag as LATE if 5+ minutes past ready time AND driver is NOT actively working on it
  const LATE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  const isLate = !!(
    readyTime &&
    (Date.now() - readyTime.getTime()) > LATE_THRESHOLD_MS &&
    !isDriverActive &&
    currentStatus !== "InTransit" &&
    currentStatus !== "Completed" &&
    currentStatus !== "Cancelled"
  );

  const driverConfirmed = !!(o.DeliveryConfirmed || o.DeliveryConfirmedTime);

  return { currentStatus, timeline, isLate, driverConfirmed };
}

/** Minimum time after confirmation before showing unassigned orders to the AI. */
const CONFIRMED_GRACE_PERIOD_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Returns true if the order was confirmed by the restaurant less than 2 minutes
 * ago. These orders are expected to be assigned a driver by the router shortly
 * and don't need AI attention yet.
 */
function isRecentlyConfirmed(o: any): boolean {
  // Use the confirmed timestamp — try OrderConfirmedNotifiedTime first (when
  // the restaurant tapped confirm), then DeliveryConfirmedTime, then fall back
  // to OrderPlacedTime as a conservative proxy.
  const confirmedEpoch =
    o.OrderConfirmedNotifiedTime ?? o.DeliveryConfirmedTime ?? o.OrderPlacedTime;
  if (!confirmedEpoch) return false;

  const confirmedAt = new Date(confirmedEpoch * 1000);
  return Date.now() - confirmedAt.getTime() < CONFIRMED_GRACE_PERIOD_MS;
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
    lines.push(`This is the initial state board — a BASELINE, not a list of problems.`);
    lines.push(`Most drivers and orders are operating normally. ONLY flag items that actually need intervention:`);
    lines.push(`- Orders that are LATE (5+ minutes past ready time with no driver progress)`);
    lines.push(`- Orders that are UNASSIGNED and need a driver`);
    lines.push(`- Drivers that are OFFLINE with active non-delivered orders`);
    lines.push(`- Open tickets that need resolution`);
    lines.push(`Do NOT message drivers who are actively working (En-Route, At-Restaurant, In-Bag, InTransit).`);
    lines.push(`Do NOT "check on" every driver — only those with actual problems.`);
    lines.push(``);

    for (const zone of zones) {
      const zd = dispatchData[zone];
      const orders = zd.Orders ?? [];
      const drivers = zd.Drivers ?? [];
      if (orders.length === 0 && drivers.length === 0) continue;

      const onShift = drivers.filter((d: any) => d.OnShift && !d.Paused);
      lines.push(`-- ${zone} (${onShift.length} drivers on-shift, ${orders.length} orders) --`);

      for (const d of drivers) {
        // Skip off-shift drivers with nothing actionable
        if (!d.OnShift && !d.Available) {
          const driverOrders = orders.filter((o: any) => o.DriverId === d.DriverId);
          const allHandled = driverOrders.every((o: any) => {
            // Pre-scheduled: ready 60+ min out
            const ready = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;
            if (ready && (ready.getTime() - Date.now()) / 60000 > 30) return true;
            // Actively delivering: InTransit, InBag, At-Customer = finishing last delivery
            const status = deriveOrderStatus(o);
            const delivering = ["intransit", "inbag", "at-customer", "atcustomer"]
              .includes(status.currentStatus.toLowerCase().replace(/[-_ ]/g, ""));
            return delivering;
          });
          if (driverOrders.length === 0 || allHandled) continue;
        }

        const status = d.Paused ? "PAUSED" : d.OnShift ? "ON-SHIFT" : d.Available ? "ON-CALL" : "OFF";
        // Only count non-pre-scheduled orders
        const visibleOrders = orders.filter((o: any) => {
          if (o.DriverId !== d.DriverId) return false;
          const ready = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;
          const minsOut = ready ? (ready.getTime() - Date.now()) / 60000 : 0;
          return !(minsOut > 30 && !d.OnShift);
        });
        const name = d.Monacher || d.FullName?.split(" ")[0] || d.DriverId.split("@")[0];
        const flags = [
          d.TrainingOrders > 0 ? `trainee(${d.TrainingOrders})` : "",
          d.Alcohol ? "smartserve" : "",
          d.NearEnd ? "NEAR-END" : "",
        ].filter(Boolean).join(", ");
        const orderIds = visibleOrders.map((o: any) => o.OrderIdKey).filter(Boolean);
        const orderIdsSuffix = orderIds.length > 0 ? ` [${orderIds.join(", ")}]` : "";
        lines.push(`  ${name} (${d.DriverId}): ${status}, ${visibleOrders.length} orders${orderIdsSuffix}${flags ? ` [${flags}]` : ""}`);
      }

      // Filter out Takeout orders — not relevant to dispatch (no driver needed)
      const deliveryOrders = orders.filter((o: any) =>
        (o.OrderType ?? "Delivery") !== "Takeout"
      );

      // Only show orders that need attention — LATE, UNASSIGNED, or problematic.
      // Orders progressing normally (assigned driver, not late) are noise.
      for (const o of deliveryOrders) {
        const readyTime = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;
        const driver = drivers.find((d: any) => d.DriverId === o.DriverId);

        // Skip pre-scheduled orders entirely — ready 60+ min out with offline driver
        const minsUntilReady = readyTime ? (readyTime.getTime() - Date.now()) / 60000 : 0;
        const driverIsOffline = driver && !driver.OnShift;
        if (minsUntilReady > 30 && driverIsOffline) continue;

        const status = deriveOrderStatus(o);
        const isUnassigned = !o.DriverId;
        const hasOfflineDriver = driver && !driver.OnShift && !driverIsOffline;

        // Skip recently confirmed unassigned orders — the router will assign
        // a driver shortly. Only surface after 2 minutes without assignment.
        if (isUnassigned && isRecentlyConfirmed(o)) continue;

        // Skip orders that are on track — has a driver, not late, progressing normally
        if (!status.isLate && !isUnassigned && !hasOfflineDriver) continue;

        const driverMonacher = driver?.Monacher || driver?.FullName?.split(" ")[0] || null;
        const driverEmail = o.DriverId || null;
        const driverLabel = driverMonacher && driverEmail
          ? `${driverMonacher} (${driverEmail})`
          : driverMonacher || driverEmail || "UNASSIGNED";
        const alcohol = o.Alcohol ? " [ALCOHOL]" : "";
        lines.push(
          `  Order ${o.OrderIdKey}: ${status.currentStatus}${status.isLate ? " LATE" : ""}${isUnassigned ? " UNASSIGNED" : ""}${alcohol} | ${o.RestaurantName} -> ${o.DeliveryStreet || "?"}, ${o.DeliveryCity || ""} | Driver: ${driverLabel} | Ready: ${formatTime(readyTime)} (${minutesAgo(readyTime)})${status.timeline ? ` | ${status.timeline}` : ""}`,
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

    // Compact summary of ALL markets so supervisor has full picture
    // (detailed breakdown follows only for affected zones)
    const marketSummary: string[] = ["-- All Markets Overview --"];
    for (const zone of zones) {
      const zd = dispatchData[zone];
      const zOrders = (zd.Orders ?? []).filter((o: any) => (o.OrderType ?? "Delivery") !== "Takeout");
      const zDrivers = (zd.Drivers ?? []).filter((d: any) => d.OnShift && !d.Paused);
      if (zOrders.length === 0 && zDrivers.length === 0) continue;
      const lateCount = zOrders.filter((o: any) => {
        const ready = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;
        return ready && (Date.now() - ready.getTime()) > 5 * 60 * 1000;
      }).length;
      const unassigned = zOrders.filter((o: any) => !o.DriverId).length;
      const flags: string[] = [];
      if (lateCount > 0) flags.push(`${lateCount} late`);
      if (unassigned > 0) flags.push(`${unassigned} unassigned`);
      marketSummary.push(`  ${zone}: ${zDrivers.length} drivers, ${zOrders.length} orders${flags.length > 0 ? ` [${flags.join(", ")}]` : ""}`);
    }
    lines.push(marketSummary.join("\n"));
    lines.push(`(Detailed breakdown below for zones with changes only)\n`);

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
        const driverOrders = orders.filter((o: any) => o.DriverId === d.DriverId);
        const name = d.Monacher || d.FullName?.split(" ")[0] || d.DriverId.split("@")[0];
        const orderIds = driverOrders.map((o: any) => o.OrderIdKey).filter(Boolean);
        const orderIdsSuffix = orderIds.length > 0 ? ` [${orderIds.join(", ")}]` : "";
        lines.push(`  ${name} (${d.DriverId}): ${status}, ${driverOrders.length} orders${orderIdsSuffix}`);
      }
      // Filter out Takeout orders — not relevant to dispatch (no driver needed)
      const deliveryOrders = orders.filter((o: any) =>
        (o.OrderType ?? "Delivery") !== "Takeout"
      );

      // Only show orders that need attention in affected zones
      for (const o of deliveryOrders) {
        const readyTime = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;
        const driver = drivers.find((d: any) => d.DriverId === o.DriverId);

        const minsUntilReady = readyTime ? (readyTime.getTime() - Date.now()) / 60000 : 0;
        const driverIsOffline = driver && !driver.OnShift;
        if (minsUntilReady > 30 && driverIsOffline) continue;

        const status = deriveOrderStatus(o);
        const isUnassigned = !o.DriverId;
        const hasOfflineDriver = driver && !driver.OnShift && !driverIsOffline;

        // Skip recently confirmed unassigned orders — the router will assign
        // a driver shortly. Only surface after 2 minutes without assignment.
        if (isUnassigned && isRecentlyConfirmed(o)) continue;

        // Skip orders that are on track — has a driver, not late, progressing normally
        if (!status.isLate && !isUnassigned && !hasOfflineDriver) continue;

        const driverMonacher = driver?.Monacher || driver?.FullName?.split(" ")[0] || null;
        const driverEmail = o.DriverId || null;
        const driverLabel = driverMonacher && driverEmail
          ? `${driverMonacher} (${driverEmail})`
          : driverMonacher || driverEmail || "UNASSIGNED";
        const alcohol = o.Alcohol ? " [ALCOHOL]" : "";
        lines.push(
          `  Order ${o.OrderIdKey}: ${status.currentStatus}${status.isLate ? " LATE" : ""}${isUnassigned ? " UNASSIGNED" : ""}${alcohol} | ${o.RestaurantName} | Driver: ${driverLabel} | Ready: ${formatTime(readyTime)} (${minutesAgo(readyTime)})${status.timeline ? ` | ${status.timeline}` : ""}`,
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
