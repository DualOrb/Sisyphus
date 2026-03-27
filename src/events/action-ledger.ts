/**
 * ActionLedger — rolling context window for the dispatch cycle.
 *
 * Accumulates a temporal log of everything the AI system has done:
 * messages sent, tickets handled, orders reassigned, follow-ups pending.
 * Rendered into the supervisor prompt each cycle so it can reason about
 * what's already happened and what's still pending.
 *
 * Self-contained, no external dependencies (no Redis, no LangGraph).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LedgerEntryKind =
  | "message_sent"
  | "ticket_handled"
  | "order_action"
  | "issue_flagged"
  | "action_blocked"
  | "action_failed";

export type LedgerEntityType = "driver" | "order" | "ticket" | "market" | "unknown";

export interface LedgerEntry {
  /** Monotonic timestamp (Date.now()) */
  ts: number;
  /** What kind of action this is */
  kind: LedgerEntryKind;
  /** The action name (e.g. "SendDriverMessage", "ResolveTicket") */
  action: string;
  /** Primary entity ID (driver email, orderId, ticketId) */
  entityId: string;
  /** Entity type for grouping in render */
  entityType: LedgerEntityType;
  /** Compact human-readable description (max ~80 chars) */
  summary: string;
  /** Outcome from guardrails (executed, cooldown_blocked, etc.) */
  outcome: string;
  /** When a follow-up should be checked (e.g. now + 5min for driver messages) */
  followUpAt?: number;
  /** How many times this entity+action combo has been attempted */
  attemptCount: number;
  /** Which cycle number recorded this */
  cycleNumber: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map an action type + outcome to a ledger entry kind. */
export function mapActionToKind(actionType: string, outcome: string): LedgerEntryKind {
  if (outcome === "cooldown_blocked" || outcome === "rate_limited") return "action_blocked";
  if (outcome === "rejected" || outcome === "circuit_broken") return "action_failed";

  switch (actionType) {
    case "SendDriverMessage":
    case "FollowUpWithDriver":
      return "message_sent";
    case "ResolveTicket":
    case "EscalateTicket":
    case "AddTicketNote":
    case "UpdateTicketOwner":
      return "ticket_handled";
    case "AssignDriverToOrder":
    case "ReassignOrder":
    case "UpdateOrderStatus":
    case "CancelOrder":
      return "order_action";
    case "FlagMarketIssue":
      return "issue_flagged";
    default:
      return "order_action";
  }
}

/** Guess entity type from action name. */
export function guessEntityTypeFromAction(actionType: string): LedgerEntityType {
  if (actionType.includes("Driver") || actionType.includes("Message") || actionType.includes("FollowUp")) return "driver";
  if (actionType.includes("Order") || actionType.includes("Assign") || actionType.includes("Reassign") || actionType.includes("Cancel")) return "order";
  if (actionType.includes("Ticket") || actionType.includes("Escalate") || actionType.includes("Note")) return "ticket";
  if (actionType.includes("Market") || actionType.includes("Flag")) return "market";
  return "unknown";
}

/** Extract the primary entity ID from parsed action result. */
export function extractEntityId(parsed: Record<string, any>): string {
  return parsed.params?.driverId
    ?? parsed.params?.orderId
    ?? parsed.params?.ticketId
    ?? parsed.params?.market
    ?? parsed.entityId
    ?? "unknown";
}

/** Build a compact ~80 char summary from a parsed action result. */
export function buildEntrySummary(parsed: Record<string, any>): string {
  const action = parsed.actionType ?? "unknown";
  const outcome = parsed.outcome ?? "";

  if (outcome === "cooldown_blocked") {
    const remaining = parsed.reason?.match(/(\d+)s remaining/)?.[1] ?? "?";
    return `${action} blocked — cooldown ${remaining}s remaining`;
  }
  if (outcome === "rejected") {
    const reason = parsed.reason ?? "unknown reason";
    return `${action} rejected: ${reason.slice(0, 50)}`;
  }

  // For executed actions, use the reasoning or a compact description
  const reasoning = parsed.reasoning ?? "";

  switch (action) {
    case "SendDriverMessage":
    case "FollowUpWithDriver": {
      const msg = parsed.params?.message ?? "";
      return `Sent: "${msg.slice(0, 50)}${msg.length > 50 ? "..." : ""}"`;
    }
    case "ResolveTicket":
      return `Resolved: ${parsed.params?.resolutionType ?? "?"} ${parsed.params?.resolution?.slice(0, 40) ?? ""}`;
    case "EscalateTicket":
      return `Escalated: ${parsed.params?.reason?.slice(0, 50) ?? ""}`;
    case "AddTicketNote":
      return `Note added: ${parsed.params?.note?.slice(0, 50) ?? ""}`;
    case "AssignDriverToOrder":
      return `Assigned driver ${parsed.params?.driverId?.split("@")[0] ?? "?"} to order`;
    case "ReassignOrder":
      return `Reassigned to ${parsed.params?.newDriverId?.split("@")[0] ?? "?"}`;
    case "CancelOrder":
      return `Cancelled: ${parsed.params?.reason?.slice(0, 40) ?? ""}`;
    case "FlagMarketIssue":
      return `Flagged: ${parsed.params?.issueType ?? "?"} (${parsed.params?.severity ?? "?"})`;
    default:
      return reasoning.slice(0, 60) || `${action} ${outcome}`;
  }
}

/** Whether this action type needs a follow-up timer. */
export function needsFollowUp(actionType: string, outcome: string): boolean {
  return outcome === "executed" &&
    (actionType === "SendDriverMessage" || actionType === "FollowUpWithDriver");
}

// ---------------------------------------------------------------------------
// Relative time formatting
// ---------------------------------------------------------------------------

function relativeTime(ts: number, now: number): string {
  const diffMs = now - ts;
  const mins = Math.round(diffMs / 60_000);
  if (mins <= 0) return "just now";
  if (mins === 1) return "1m ago";
  return `${mins}m ago`;
}

function relativeTimeFuture(ts: number, now: number): string {
  const diffMs = ts - now;
  const mins = Math.round(diffMs / 60_000);
  if (mins <= 0) return "NOW";
  if (mins === 1) return "in 1m";
  return `in ${mins}m`;
}

// ---------------------------------------------------------------------------
// ActionLedger
// ---------------------------------------------------------------------------

const DEFAULT_MAX_AGE_MS = 45 * 60_000;  // 45 minutes
const DEFAULT_MAX_ENTRIES = 200;
const RENDER_WINDOW_MS = 30 * 60_000;     // 30 minutes for prompt rendering
const FOLLOW_UP_INTERVAL_MS = 5 * 60_000; // 5 minutes
const FOLLOW_UP_STALE_MS = 15 * 60_000;   // 15 minutes = stale

export class ActionLedger {
  private entries: LedgerEntry[] = [];
  private readonly maxAgeMs: number;
  private readonly maxEntries: number;

  constructor(opts?: { maxAgeMs?: number; maxEntries?: number }) {
    this.maxAgeMs = opts?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /** Record a new action. Auto-increments attemptCount for matching entity+action pairs. */
  record(entry: Omit<LedgerEntry, "attemptCount">): void {
    const attemptCount = this.countAttempts(entry.entityId, entry.action) + 1;
    this.entries.push({ ...entry, attemptCount });
  }

  /** Prune entries older than maxAgeMs or beyond maxEntries. */
  prune(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    this.entries = this.entries.filter((e) => e.ts > cutoff);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  /** Count how many times an action has been attempted on an entity. */
  private countAttempts(entityId: string, action: string): number {
    return this.entries.filter(
      (e) => e.entityId === entityId && e.action === action,
    ).length;
  }

  /** Check if any action has been taken on an entity. */
  hasEntity(entityId: string): boolean {
    return this.entries.some((e) => e.entityId === entityId);
  }

  /** Get the total entry count. */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Render compact prompt section grouped by entity with temporal markers.
   * Returns empty string if no entries in the render window.
   */
  renderForPrompt(now?: number): string {
    const n = now ?? Date.now();
    const renderCutoff = n - RENDER_WINDOW_MS;

    // Filter to render window
    const visible = this.entries.filter((e) => e.ts > renderCutoff);
    if (visible.length === 0) return "";

    // Group by entityType, then entityId
    const groups = new Map<string, Map<string, LedgerEntry[]>>();
    for (const e of visible) {
      if (!groups.has(e.entityType)) groups.set(e.entityType, new Map());
      const typeGroup = groups.get(e.entityType)!;
      if (!typeGroup.has(e.entityId)) typeGroup.set(e.entityId, []);
      typeGroup.get(e.entityId)!.push(e);
    }

    const lines: string[] = ["-- RECENT ACTIONS (last 30min) --", ""];

    // Render order: drivers, orders, tickets, market, unknown
    const typeOrder: LedgerEntityType[] = ["driver", "order", "ticket", "market", "unknown"];
    const typeLabels: Record<string, string> = {
      driver: "DRIVERS",
      order: "ORDERS",
      ticket: "TICKETS",
      market: "MARKET",
      unknown: "OTHER",
    };

    for (const entityType of typeOrder) {
      const typeGroup = groups.get(entityType);
      if (!typeGroup || typeGroup.size === 0) continue;

      lines.push(`${typeLabels[entityType]}:`);

      for (const [entityId, entries] of typeGroup) {
        // Sort newest first, take max 3
        const sorted = [...entries].sort((a, b) => b.ts - a.ts).slice(0, 3);
        lines.push(`  ${entityId}:`);

        for (const e of sorted) {
          let line = `    - [${relativeTime(e.ts, n)}] ${e.summary} (${e.outcome})`;
          if (e.attemptCount > 1) line += ` [attempted ${e.attemptCount}x]`;
          if (e.followUpAt && e.followUpAt > n) {
            line += ` [follow-up ${relativeTimeFuture(e.followUpAt, n)}]`;
          }
          lines.push(line);
        }
      }
      lines.push("");
    }

    // Pending follow-ups section — most important, goes last
    const pendingFollowUps = this.entries.filter((e) => {
      if (e.followUpAt == null) return false;
      if (e.ts < renderCutoff) return false;
      if (n - e.ts > FOLLOW_UP_STALE_MS) return false;
      return true;
    });

    if (pendingFollowUps.length > 0) {
      lines.push("PENDING FOLLOW-UPS:");
      for (const e of pendingFollowUps) {
        const ago = relativeTime(e.ts, n);
        if (e.followUpAt! <= n) {
          const overdueMin = Math.round((n - e.followUpAt!) / 60_000);
          lines.push(`  ${e.entityId}: messaged ${ago} — follow-up OVERDUE by ${overdueMin}m`);
        } else {
          lines.push(`  ${e.entityId}: messaged ${ago} — follow-up due ${relativeTimeFuture(e.followUpAt!, n)}`);
        }
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /** Serialize to JSON for Redis persistence. */
  toJSON(): string {
    return JSON.stringify(this.entries);
  }

  /** Restore from JSON. */
  static fromJSON(json: string, opts?: { maxAgeMs?: number; maxEntries?: number }): ActionLedger {
    const ledger = new ActionLedger(opts);
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        // Validate entries have required fields before restoring
        const valid = parsed.filter(
          (e: unknown): e is LedgerEntry =>
            typeof e === "object" && e !== null &&
            typeof (e as any).ts === "number" &&
            typeof (e as any).kind === "string" &&
            typeof (e as any).action === "string",
        );
        ledger.entries = valid;
        ledger.prune();
      }
    } catch {
      // Corrupted JSON — start fresh
    }
    return ledger;
  }
}

// Re-export the follow-up interval for external use
export { FOLLOW_UP_INTERVAL_MS };
