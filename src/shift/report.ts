/**
 * Shift report generator for Sisyphus AI Dispatcher.
 *
 * After each shadow shift, produces a structured ShiftReport summarising
 * every decision Sisyphus made (or would have made). The dispatch team uses
 * this to evaluate decision quality before granting higher autonomy tiers.
 *
 * @module shift/report
 */

import type { ShiftStats } from "./activities.js";
import type { Proposal } from "../execution/shadow/executor.js";
import type { ShadowSummary } from "../execution/shadow/metrics.js";
import type { AuditRecord, ActionOutcome, Tier } from "../guardrails/types.js";
import type { UsageSummary } from "../llm/token-tracker.js";

// ---------------------------------------------------------------------------
// Report interfaces
// ---------------------------------------------------------------------------

export interface ReportSummary {
  shiftDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  operatingMode: "shadow" | "live";
}

export interface ActionStats {
  total: number;
  byType: Record<string, number>;
  byTier: Record<string, number>;
  byOutcome: Record<string, number>;
}

export interface MarketHealthEntry {
  market: string;
  ordersHandled: number;
  issuesFlagged: number;
  driverCoverage: number;
}

export interface AgentPerformanceEntry {
  agentId: string;
  actionCount: number;
  escalationCount: number;
  escalationRate: number;
}

export interface ProposalEntry {
  id: string;
  timestamp: string;
  actionName: string;
  tier: string;
  reasoning: string;
  agentId: string;
  wouldExecuteVia: string;
  validationPassed: boolean | null;
  params: Record<string, unknown>;
}

export interface EscalationEntry {
  id: string;
  timestamp: string;
  actionType: string;
  agentId: string;
  reasoning: string;
  outcome: string;
}

export interface ErrorEntry {
  id: string;
  timestamp: string;
  actionType: string;
  outcome: string;
  reason: string;
}

export interface TokenUsageSection {
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  estimatedCostUsd: number;
  byModel: Record<string, { input: number; output: number }>;
}

export interface ShiftReport {
  generatedAt: string;
  summary: ReportSummary;
  actionStats: ActionStats;
  marketHealth: MarketHealthEntry[];
  agentPerformance: AgentPerformanceEntry[];
  proposals: ProposalEntry[];
  escalations: EscalationEntry[];
  errors: ErrorEntry[];
  tokenUsage: TokenUsageSection;
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface ShiftReportInput {
  shiftStats: ShiftStats;
  proposals: Proposal[];
  metrics: ShadowSummary;
  auditRecords: AuditRecord[];
  tokenUsage: UsageSummary;
  /** Estimated LLM cost in USD (from TokenTracker.estimateCost()). */
  estimatedCostUsd?: number;
  /** Override operating mode label (defaults to "shadow"). */
  operatingMode?: "shadow" | "live";
}

// ---------------------------------------------------------------------------
// Tier priority (higher = more significant)
// ---------------------------------------------------------------------------

const TIER_PRIORITY: Record<string, number> = {
  RED: 4,
  ORANGE: 3,
  YELLOW: 2,
  GREEN: 1,
  UNKNOWN: 0,
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Build a structured ShiftReport from raw shift data.
 *
 * The report is a plain data object — use the formatter modules to convert
 * it to Markdown or JSON for human / programmatic consumption.
 */
export function generateShiftReport(input: ShiftReportInput): ShiftReport {
  const {
    shiftStats,
    proposals,
    metrics,
    auditRecords,
    tokenUsage,
    estimatedCostUsd = 0,
    operatingMode = "shadow",
  } = input;

  const now = new Date();
  const startTime = new Date(shiftStats.shiftStartedAt);
  const endTime = now;
  const durationMinutes = Math.round(
    (endTime.getTime() - startTime.getTime()) / 60_000,
  );

  // ---- Summary ----
  const summary: ReportSummary = {
    shiftDate: startTime.toISOString().slice(0, 10),
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    durationMinutes,
    operatingMode,
  };

  // ---- Action stats ----
  const byOutcome = buildOutcomeCounts(auditRecords);
  const actionStats: ActionStats = {
    total: metrics.totalProposals,
    byType: { ...metrics.byAction },
    byTier: { ...metrics.byTier },
    byOutcome,
  };

  // ---- Market health ----
  const marketHealth = buildMarketHealth(proposals, auditRecords);

  // ---- Agent performance ----
  const agentPerformance = buildAgentPerformance(proposals, auditRecords);

  // ---- Top proposals (10, highest tier first) ----
  const sortedProposals = [...proposals].sort((a, b) => {
    const tierDiff =
      (TIER_PRIORITY[b.tier] ?? 0) - (TIER_PRIORITY[a.tier] ?? 0);
    if (tierDiff !== 0) return tierDiff;
    return b.timestamp.getTime() - a.timestamp.getTime();
  });

  const topProposals: ProposalEntry[] = sortedProposals
    .slice(0, 10)
    .map(toProposalEntry);

  // ---- Escalations ----
  const escalations = buildEscalations(auditRecords);

  // ---- Errors ----
  const errors = buildErrors(auditRecords);

  // ---- Token usage ----
  const tokenUsageSection: TokenUsageSection = {
    totalInput: tokenUsage.totalInput,
    totalOutput: tokenUsage.totalOutput,
    totalTokens: tokenUsage.totalInput + tokenUsage.totalOutput,
    estimatedCostUsd,
    byModel: { ...tokenUsage.byModel },
  };

  // ---- Auto-generated recommendations ----
  const recommendations = generateRecommendations(
    shiftStats,
    proposals,
    auditRecords,
    marketHealth,
    agentPerformance,
    actionStats,
  );

  return {
    generatedAt: now.toISOString(),
    summary,
    actionStats,
    marketHealth,
    agentPerformance,
    proposals: topProposals,
    escalations,
    errors,
    tokenUsage: tokenUsageSection,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toProposalEntry(p: Proposal): ProposalEntry {
  return {
    id: p.id,
    timestamp: p.timestamp.toISOString(),
    actionName: p.actionName,
    tier: p.tier,
    reasoning: p.reasoning ?? "",
    agentId: p.agentId ?? "unknown",
    wouldExecuteVia: p.wouldExecuteVia,
    validationPassed: p.validationResult?.passed ?? null,
    params: p.params,
  };
}

function buildOutcomeCounts(
  records: AuditRecord[],
): Record<string, number> {
  const counts: Record<string, number> = {
    executed: 0,
    staged: 0,
    rejected: 0,
    blocked: 0,
  };

  for (const r of records) {
    const key = normaliseOutcome(r.outcome);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

function normaliseOutcome(outcome: ActionOutcome): string {
  switch (outcome) {
    case "executed":
      return "executed";
    case "staged":
      return "staged";
    case "rejected":
      return "rejected";
    case "cooldown_blocked":
    case "rate_limited":
    case "circuit_broken":
      return "blocked";
    default:
      return outcome;
  }
}

function buildMarketHealth(
  proposals: Proposal[],
  auditRecords: AuditRecord[],
): MarketHealthEntry[] {
  const marketMap = new Map<
    string,
    { orders: number; issues: number; drivers: Set<string> }
  >();

  function ensureMarket(name: string) {
    if (!marketMap.has(name)) {
      marketMap.set(name, { orders: 0, issues: 0, drivers: new Set() });
    }
    return marketMap.get(name)!;
  }

  // Mine market info from proposal params
  for (const p of proposals) {
    const market =
      (p.params.market as string) ??
      (p.params.deliveryZone as string) ??
      null;
    if (!market) continue;

    const entry = ensureMarket(market);

    if (
      p.actionName.toLowerCase().includes("order") ||
      p.actionName.toLowerCase().includes("assign")
    ) {
      entry.orders++;
    }

    if (
      p.actionName.toLowerCase().includes("escalat") ||
      p.actionName.toLowerCase().includes("ticket")
    ) {
      entry.issues++;
    }

    const driverId = p.params.driverId as string | undefined;
    if (driverId) {
      entry.drivers.add(driverId);
    }
  }

  // Also look at audit records for market context
  for (const r of auditRecords) {
    const market =
      (r.params.market as string) ??
      (r.params.deliveryZone as string) ??
      null;
    if (!market) continue;

    const entry = ensureMarket(market);

    if (r.outcome === "rejected" || r.outcome === "cooldown_blocked") {
      entry.issues++;
    }
  }

  return Array.from(marketMap.entries())
    .map(([market, data]) => ({
      market,
      ordersHandled: data.orders,
      issuesFlagged: data.issues,
      driverCoverage: data.drivers.size,
    }))
    .sort((a, b) => b.ordersHandled - a.ordersHandled);
}

function buildAgentPerformance(
  proposals: Proposal[],
  auditRecords: AuditRecord[],
): AgentPerformanceEntry[] {
  const agentMap = new Map<
    string,
    { actions: number; escalations: number }
  >();

  function ensure(agentId: string) {
    if (!agentMap.has(agentId)) {
      agentMap.set(agentId, { actions: 0, escalations: 0 });
    }
    return agentMap.get(agentId)!;
  }

  for (const p of proposals) {
    const id = p.agentId ?? "unknown";
    const entry = ensure(id);
    entry.actions++;

    if (
      p.tier === "RED" ||
      p.actionName.toLowerCase().includes("escalat")
    ) {
      entry.escalations++;
    }
  }

  // Merge audit record data
  for (const r of auditRecords) {
    const entry = ensure(r.agentId);
    // Don't double-count actions; only add escalation info from records
    if (
      r.outcome === "staged" &&
      !proposals.some(
        (p) => p.agentId === r.agentId && p.actionName === r.actionType,
      )
    ) {
      entry.escalations++;
    }
  }

  return Array.from(agentMap.entries())
    .map(([agentId, data]) => ({
      agentId,
      actionCount: data.actions,
      escalationCount: data.escalations,
      escalationRate:
        data.actions > 0
          ? Math.round((data.escalations / data.actions) * 100) / 100
          : 0,
    }))
    .sort((a, b) => b.actionCount - a.actionCount);
}

function buildEscalations(auditRecords: AuditRecord[]): EscalationEntry[] {
  return auditRecords
    .filter(
      (r) =>
        r.outcome === "staged" ||
        r.actionType.toLowerCase().includes("escalat"),
    )
    .map((r) => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      actionType: r.actionType,
      agentId: r.agentId,
      reasoning: r.reasoning,
      outcome: r.outcome,
    }));
}

function buildErrors(auditRecords: AuditRecord[]): ErrorEntry[] {
  const blocked: ActionOutcome[] = [
    "rejected",
    "cooldown_blocked",
    "rate_limited",
    "circuit_broken",
  ];

  return auditRecords
    .filter((r) => blocked.includes(r.outcome))
    .map((r) => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      actionType: r.actionType,
      outcome: r.outcome,
      reason: extractReason(r),
    }));
}

function extractReason(record: AuditRecord): string {
  // Try to pull a human-readable reason from the submission check results
  const check = record.submissionCheck;
  if (typeof check === "object" && check !== null) {
    const messages: string[] = [];
    for (const [key, val] of Object.entries(check)) {
      if (typeof val === "object" && val !== null && "message" in val) {
        messages.push(`${key}: ${(val as { message: string }).message}`);
      }
    }
    if (messages.length > 0) return messages.join("; ");
  }
  return `Action ${record.outcome}`;
}

// ---------------------------------------------------------------------------
// Recommendation engine
// ---------------------------------------------------------------------------

function generateRecommendations(
  shiftStats: ShiftStats,
  proposals: Proposal[],
  auditRecords: AuditRecord[],
  marketHealth: MarketHealthEntry[],
  agentPerformance: AgentPerformanceEntry[],
  actionStats: ActionStats,
): string[] {
  const recs: string[] = [];

  // High error rate
  if (shiftStats.errorsEncountered > 5) {
    recs.push(
      `High error count this shift (${shiftStats.errorsEncountered}). ` +
        `Investigate recurring failure patterns and consider adding circuit breakers.`,
    );
  }

  // Markets with low driver coverage
  for (const m of marketHealth) {
    if (m.ordersHandled > 0 && m.driverCoverage < 2) {
      recs.push(
        `Consider adding more drivers to ${m.market} — only ${m.driverCoverage} ` +
          `driver(s) covered ${m.ordersHandled} order(s) this shift.`,
      );
    }
  }

  // Markets with high issue counts
  for (const m of marketHealth) {
    if (m.issuesFlagged >= 3) {
      recs.push(
        `${m.market} had ${m.issuesFlagged} issues flagged. Review market conditions ` +
          `and consider adjusting staffing or restaurant partner SLAs.`,
      );
    }
  }

  // High escalation rate for specific agents
  for (const a of agentPerformance) {
    if (a.actionCount >= 5 && a.escalationRate > 0.3) {
      recs.push(
        `Agent "${a.agentId}" escalated ${Math.round(a.escalationRate * 100)}% of actions. ` +
          `Review if this agent's confidence thresholds are too conservative.`,
      );
    }
  }

  // High rejection rate
  const rejected = actionStats.byOutcome["rejected"] ?? 0;
  const blocked = actionStats.byOutcome["blocked"] ?? 0;
  const total = actionStats.total;
  if (total > 0 && (rejected + blocked) / total > 0.2) {
    recs.push(
      `${rejected + blocked} out of ${total} actions were rejected or blocked ` +
        `(${Math.round(((rejected + blocked) / total) * 100)}%). ` +
        `Review guardrail criteria to ensure they are not overly restrictive.`,
    );
  }

  // Validation failure rate from metrics
  const valFailed = proposals.filter(
    (p) => p.validationResult && !p.validationResult.passed,
  ).length;
  if (proposals.length > 0 && valFailed / proposals.length > 0.15) {
    recs.push(
      `${valFailed} of ${proposals.length} proposals failed validation ` +
        `(${Math.round((valFailed / proposals.length) * 100)}%). ` +
        `Consider refining action parameter schemas or agent prompts.`,
    );
  }

  // Browser reconnections
  if (shiftStats.browserReconnections > 2) {
    recs.push(
      `Browser reconnected ${shiftStats.browserReconnections} times. ` +
        `Check Chrome stability and consider increasing CDP timeout.`,
    );
  }

  // Low dispatch cycle count may indicate idle shift
  if (shiftStats.dispatchCycles < 3 && shiftStats.dispatchCycles > 0) {
    recs.push(
      `Only ${shiftStats.dispatchCycles} dispatch cycles ran. ` +
        `Verify the shift schedule and cycle interval are configured correctly.`,
    );
  }

  // No proposals at all — may be a configuration issue
  if (proposals.length === 0) {
    recs.push(
      `No proposals were generated this shift. Verify that the agent pipeline is ` +
        `active and receiving events from the ontology sync.`,
    );
  }

  // If nothing to recommend, say so explicitly
  if (recs.length === 0) {
    recs.push(
      "Shift completed within normal parameters. No immediate action items.",
    );
  }

  return recs;
}
