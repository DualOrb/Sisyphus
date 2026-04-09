/**
 * Dispatch cycle — the core intelligence loop for Sisyphus.
 *
 * Each cycle:
 *  1. Accepts raw dispatch.txt data (caller fetches from S3)
 *  2. Diffs current vs previous dispatch data to detect changes
 *  3. Decides whether to invoke the LLM (first cycle, changes, heartbeat)
 *  4. Builds a focused prompt (full board every cycle)
 *  5. Invokes the LangGraph dispatch graph with a fresh thread per cycle
 *  6. Extracts a rolling summary for cross-cycle context
 *  7. Returns a CycleResult describing what happened
 *
 * Change detection, prompt building, and event conversion are in separate
 * modules to keep this file focused on orchestration.
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
import { detectChanges, type Changes, type ChangeDetail } from "./changes.js";
import { buildChangesPrompt, buildFocusAreas, extractCycleSummary, changesToEvents } from "./prompt-builder.js";

const log = createChildLogger("events:cycle");

// Re-export types for consumers that import from cycle.ts
export type { ChangeDetail, Changes } from "./changes.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CycleResult {
  eventsProcessed: number;
  graphInvoked: boolean;
  duration: number;
  changesDetected: number;
  reason: "initial" | "changes" | "heartbeat" | "skipped";
  summary?: string;
  /** Full prompt sent to the supervisor (for debugging/tuning). */
  prompt?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EVENTS_PER_CYCLE = 10;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 90_000;
const DEFAULT_LLM_COOLDOWN_MS = 30_000;

// ---------------------------------------------------------------------------
// DispatchGraph interface
// ---------------------------------------------------------------------------

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
  shiftHandoff?: { notes?: string | null; issues?: unknown; escalations?: number | null } | null;
  shiftId?: string;
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

  private previousDispatchData: any = null;
  private cycleSummary = "";
  private cycleCount = 0;
  private lastLlmCall = 0;
  private isFirstCycle = true;
  private previousStore: OntologyStore | undefined;

  private readonly dispatchedIssues = new Map<string, number>();
  private static readonly DEDUP_TTL_MS = 300_000;

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

  async run(dispatchData?: any): Promise<CycleResult> {
    const start = Date.now();
    this.cycleCount++;

    // 1. Collect driver messages from WebSocket
    const messageEvents = this.collectDriverMessages();

    // 2. Detect changes by diffing dispatch.txt data
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

    // 2b. Annotate recurring issues for escalation awareness
    if (!this.isFirstCycle && changes.hasChanges) {
      this.annotateRecurringIssues(changes);
    }

    // 3. Run EventDetector + enqueue all events
    const ontologyEvents = this.detector.detect(this.store, this.previousStore);
    const changeEvents = changesToEvents(changes);
    this.eventQueue.enqueueAll(messageEvents);
    this.eventQueue.enqueueAll(ontologyEvents);
    this.eventQueue.enqueueAll(changeEvents);

    // 4. Decide whether to invoke the graph
    const timeSinceLastLlm = Date.now() - this.lastLlmCall;
    const isHeartbeat = timeSinceLastLlm > this.heartbeatIntervalMs && !this.isFirstCycle;

    const shouldInvokeGraph =
      (this.isFirstCycle || changes.hasChanges || isHeartbeat) &&
      timeSinceLastLlm > this.llmCooldownMs;

    if (!shouldInvokeGraph && !this.isFirstCycle) {
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

    // 5. Build the prompt
    const combinedPrompt = this.buildPrompt(changes, dispatchData, isHeartbeat);

    const reason: CycleResult["reason"] = this.isFirstCycle
      ? "initial"
      : isHeartbeat
        ? "heartbeat"
        : "changes";

    log.info(
      { reason, changesDetected: changes.details.length, cycleCount: this.cycleCount },
      "Invoking dispatch graph",
    );

    // 6. Invoke graph
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

      const messages = (result as any)?.messages ?? [];
      summary = extractCycleSummary(messages);
      this.cycleSummary = summary ?? "";

      this.recordActionsToLedger(messages);
    } catch (err) {
      this.lastLlmCall = Date.now();
      this.isFirstCycle = false;
      log.error({ err }, "Graph invocation failed");
    }

    // 7. Save current state for next diff
    if (dispatchData) {
      this.previousDispatchData = dispatchData;
    }
    this.previousStore = this.snapshotStore();

    const duration = Date.now() - start;
    log.info(
      { reason, changesDetected: changes.details.length, graphInvoked, duration },
      "Dispatch cycle complete",
    );

    return {
      eventsProcessed: changes.details.length,
      graphInvoked,
      duration,
      changesDetected: changes.details.length,
      reason,
      summary,
      prompt: combinedPrompt,
    };
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

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

  private annotateRecurringIssues(changes: Changes): void {
    const now = Date.now();
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
      this.dispatchedIssues.set(key, prevTime ?? now);
    }
  }

  private buildPrompt(changes: Changes, dispatchData: any, _isHeartbeat: boolean): string {
    let combinedPrompt = "";

    // Shift handoff (first cycle only)
    if (this.isFirstCycle && this.shiftHandoff) {
      const handoffParts: string[] = [];
      if (this.shiftHandoff.notes) handoffParts.push(`Notes: ${this.shiftHandoff.notes}`);
      if (this.shiftHandoff.issues) {
        const issuesStr = typeof this.shiftHandoff.issues === "string"
          ? this.shiftHandoff.issues : JSON.stringify(this.shiftHandoff.issues);
        handoffParts.push(`Unresolved issues: ${issuesStr}`);
      }
      if (this.shiftHandoff.escalations && this.shiftHandoff.escalations > 0) {
        handoffParts.push(`Escalations from previous shift: ${this.shiftHandoff.escalations}`);
      }
      if (handoffParts.length > 0) {
        combinedPrompt = `PREVIOUS SHIFT HANDOFF: ${handoffParts.join(" | ")}\n\n`;
      }
    }

    // Rolling context
    if (this.cycleSummary) {
      combinedPrompt += `PREVIOUS CYCLE SUMMARY: ${this.cycleSummary}\n\n`;
    }

    // Action ledger
    if (!this.isFirstCycle) {
      const ledgerSection = this.ledger.renderForPrompt();
      if (ledgerSection) combinedPrompt += ledgerSection + "\n";
    }

    // Dispatch board
    if (dispatchData) {
      combinedPrompt += buildChangesPrompt(changes, dispatchData, this.isFirstCycle, this.store);

      // Open tickets
      const ticketPrompt = this.buildTicketSection();
      if (ticketPrompt) combinedPrompt += ticketPrompt;
    }

    // Event pipeline
    if (!this.eventQueue.isEmpty) {
      const batch: PrioritizedEvent[] = [];
      const allEvents = this.eventQueue.drain();
      for (const evt of allEvents) {
        if (batch.length < MAX_EVENTS_PER_CYCLE) batch.push(evt);
        else this.eventQueue.enqueue(evt);
      }
      if (batch.length > 0) {
        const eventMessage = this.dispatcher.buildDispatchMessage(batch);
        combinedPrompt += `\n\n---\n\n${eventMessage}`;
      }
    }

    combinedPrompt += buildFocusAreas(this.store);
    return combinedPrompt;
  }

  private buildTicketSection(): string {
    const ticketCount = this.store.tickets.size;
    if (ticketCount === 0) return "";

    const ticketLines: string[] = [];
    let shownCount = 0;
    let skippedCount = 0;

    for (const t of this.store.tickets.values()) {
      if (this.ledger.hasEntity(t.issueId)) { skippedCount++; continue; }
      if (t.owner !== "Unassigned") { skippedCount++; continue; }

      const age = Math.round((Date.now() - t.createdAt.getTime()) / 60000);
      const orderRef = t.orderIdKey ? ` | order: ${t.orderIdKey}` : "";
      ticketLines.push(
        `  ticket ${t.issueId}: [${t.status}] [UNASSIGNED] ${t.category} / ${t.issueType} -- ${t.restaurantName ?? t.originator}${orderRef} (${age}m old)`,
      );
      shownCount++;
      this.dispatchedIssues.set(`ticket:${t.issueId}`, Date.now());
    }

    let result = "";
    if (shownCount > 0) {
      result += `\n-- Open Tickets Needing Resolution (${shownCount}) --\n`;
      result += ticketLines.join("\n") + "\n";
    }
    if (skippedCount > 0) {
      result += `(${skippedCount} ticket(s) already handled or assigned — not shown)\n`;
    }
    return result;
  }

  private recordActionsToLedger(messages: any[]): void {
    this.ledger.prune();
    const nowMs = Date.now();

    const toolCallArgs = new Map<string, { actionName: string; params: Record<string, any>; reasoning: string }>();
    for (const msg of messages) {
      if (msg.constructor?.name !== "AIMessage") continue;
      const aiMsg = msg as AIMessage;
      for (const tc of (aiMsg.tool_calls ?? [])) {
        if (tc.name === "execute_action" && tc.id) {
          toolCallArgs.set(tc.id, {
            actionName: (tc.args as any)?.actionName ?? "unknown",
            params: (tc.args as any)?.params ?? {},
            reasoning: (tc.args as any)?.reasoning ?? "",
          });
        }
      }
    }

    for (const msg of messages) {
      if (msg.constructor?.name !== "ToolMessage") continue;
      const content = typeof (msg as any).content === "string" ? (msg as any).content : "";
      if ((msg as any).name !== "execute_action") continue;

      try {
        const result = JSON.parse(content);
        const outcome = result.outcome ?? (result.skipped ? "skipped" : "unknown");
        const callArgs = (msg as any).tool_call_id ? toolCallArgs.get((msg as any).tool_call_id) : undefined;
        const actionType = callArgs?.actionName ?? result.actionType ?? "unknown";
        const params = callArgs?.params ?? result.params ?? {};
        const reasoning = callArgs?.reasoning ?? result.reasoning ?? "";
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
  }

  private snapshotStore(): OntologyStore {
    const StoreClass = this.store.constructor as new () => OntologyStore;
    const snapshot = new StoreClass();
    snapshot.updateOrders([...this.store.orders.values()]);
    snapshot.updateDrivers([...this.store.drivers.values()]);
    snapshot.updateMarkets([...this.store.markets.values()]);
    snapshot.updateTickets([...this.store.tickets.values()]);
    return snapshot;
  }
}
