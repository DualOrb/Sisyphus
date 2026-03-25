/**
 * Markdown formatter for Sisyphus shift reports.
 *
 * Produces a clean, professional Markdown document that a dispatch manager
 * would actually want to read — complete with tables, bold callouts, and
 * structured sections.
 *
 * @module shift/report-formatter
 */

import type {
  ShiftReport,
  ProposalEntry,
  EscalationEntry,
  ErrorEntry,
  MarketHealthEntry,
  AgentPerformanceEntry,
} from "./report.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function formatReportAsMarkdown(report: ShiftReport): string {
  const sections = [
    renderTitle(report),
    renderExecutiveSummary(report),
    renderActionBreakdown(report),
    renderMarketHealth(report),
    renderAgentPerformance(report),
    renderNotableProposals(report),
    renderEscalations(report),
    renderErrorsAndBlocks(report),
    renderTokenUsage(report),
    renderRecommendations(report),
    renderFooter(report),
  ];

  return sections.join("\n\n---\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderTitle(report: ShiftReport): string {
  const mode = report.summary.operatingMode.toUpperCase();
  return [
    `# Sisyphus Shift Report — ${report.summary.shiftDate}`,
    "",
    `> **Mode:** ${mode} | **Generated:** ${formatTimestamp(report.generatedAt)}`,
  ].join("\n");
}

function renderExecutiveSummary(report: ShiftReport): string {
  const s = report.summary;
  const a = report.actionStats;
  const hours = Math.floor(s.durationMinutes / 60);
  const mins = s.durationMinutes % 60;
  const durationStr =
    hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const executed = a.byOutcome["executed"] ?? 0;
  const staged = a.byOutcome["staged"] ?? 0;
  const rejected = a.byOutcome["rejected"] ?? 0;
  const blocked = a.byOutcome["blocked"] ?? 0;

  return [
    `## Executive Summary`,
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| **Shift Date** | ${s.shiftDate} |`,
    `| **Start Time** | ${formatTimestamp(s.startTime)} |`,
    `| **End Time** | ${formatTimestamp(s.endTime)} |`,
    `| **Duration** | **${durationStr}** |`,
    `| **Operating Mode** | ${s.operatingMode} |`,
    `| **Total Actions** | **${a.total}** |`,
    `| **Executed** | ${executed} |`,
    `| **Staged for Review** | ${staged} |`,
    `| **Rejected** | ${rejected} |`,
    `| **Blocked** | ${blocked} |`,
    `| **Escalations** | ${report.escalations.length} |`,
    `| **Errors** | ${report.errors.length} |`,
  ].join("\n");
}

function renderActionBreakdown(report: ShiftReport): string {
  const a = report.actionStats;

  const lines = [
    `## Action Breakdown`,
    "",
  ];

  // By type
  const types = Object.entries(a.byType).sort(([, a], [, b]) => b - a);
  if (types.length > 0) {
    lines.push(`### By Action Type`);
    lines.push("");
    lines.push(`| Action | Count | % of Total |`);
    lines.push(`|--------|------:|:----------:|`);
    for (const [name, count] of types) {
      const pct = a.total > 0 ? Math.round((count / a.total) * 100) : 0;
      lines.push(`| \`${name}\` | **${count}** | ${pct}% |`);
    }
    lines.push("");
  }

  // By tier
  const tiers = Object.entries(a.byTier).sort(
    ([a], [b]) => tierOrder(b) - tierOrder(a),
  );
  if (tiers.length > 0) {
    lines.push(`### By Autonomy Tier`);
    lines.push("");
    lines.push(`| Tier | Count | % of Total |`);
    lines.push(`|------|------:|:----------:|`);
    for (const [tier, count] of tiers) {
      const pct = a.total > 0 ? Math.round((count / a.total) * 100) : 0;
      lines.push(`| ${tierBadge(tier)} | **${count}** | ${pct}% |`);
    }
    lines.push("");
  }

  // By outcome
  const outcomes = Object.entries(a.byOutcome).filter(([, v]) => v > 0);
  if (outcomes.length > 0) {
    lines.push(`### By Outcome`);
    lines.push("");
    lines.push(`| Outcome | Count | % of Total |`);
    lines.push(`|---------|------:|:----------:|`);
    for (const [outcome, count] of outcomes) {
      const pct = a.total > 0 ? Math.round((count / a.total) * 100) : 0;
      lines.push(`| ${capitalize(outcome)} | **${count}** | ${pct}% |`);
    }
  }

  return lines.join("\n");
}

function renderMarketHealth(report: ShiftReport): string {
  const lines = [`## Market Health`];

  if (report.marketHealth.length === 0) {
    lines.push("", "_No market-level data available for this shift._");
    return lines.join("\n");
  }

  lines.push("");
  lines.push(
    `| Market | Orders Handled | Issues Flagged | Driver Coverage |`,
  );
  lines.push(
    `|--------|---------------:|---------------:|:---------------:|`,
  );

  for (const m of report.marketHealth) {
    const coverageStr =
      m.driverCoverage === 0
        ? "**0** (none)"
        : m.driverCoverage < 2
          ? `**${m.driverCoverage}** (low)`
          : `${m.driverCoverage}`;
    lines.push(
      `| **${m.market}** | ${m.ordersHandled} | ${m.issuesFlagged} | ${coverageStr} |`,
    );
  }

  return lines.join("\n");
}

function renderAgentPerformance(report: ShiftReport): string {
  const lines = [`## Agent Performance`];

  if (report.agentPerformance.length === 0) {
    lines.push("", "_No agent-level data available for this shift._");
    return lines.join("\n");
  }

  lines.push("");
  lines.push(
    `| Agent | Actions | Escalations | Escalation Rate |`,
  );
  lines.push(
    `|-------|--------:|------------:|:---------------:|`,
  );

  for (const a of report.agentPerformance) {
    const rateStr = `${Math.round(a.escalationRate * 100)}%`;
    const rateDisplay =
      a.escalationRate > 0.3 ? `**${rateStr}**` : rateStr;
    lines.push(
      `| \`${a.agentId}\` | ${a.actionCount} | ${a.escalationCount} | ${rateDisplay} |`,
    );
  }

  return lines.join("\n");
}

function renderNotableProposals(report: ShiftReport): string {
  const lines = [`## Notable Proposals`];

  if (report.proposals.length === 0) {
    lines.push("", "_No proposals recorded this shift._");
    return lines.join("\n");
  }

  lines.push(
    "",
    `_Top ${report.proposals.length} proposals by tier significance:_`,
    "",
  );

  for (let i = 0; i < report.proposals.length; i++) {
    const p = report.proposals[i];
    const validStr =
      p.validationPassed === null
        ? "N/A"
        : p.validationPassed
          ? "Passed"
          : "**FAILED**";

    lines.push(`### ${i + 1}. \`${p.actionName}\` — ${tierBadge(p.tier)}`);
    lines.push("");
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| **ID** | \`${p.id}\` |`);
    lines.push(`| **Time** | ${formatTimestamp(p.timestamp)} |`);
    lines.push(`| **Agent** | \`${p.agentId}\` |`);
    lines.push(`| **Method** | ${p.wouldExecuteVia} |`);
    lines.push(`| **Validation** | ${validStr} |`);
    lines.push("");
    lines.push(`> **Reasoning:** ${p.reasoning || "_none provided_"}`);
    lines.push("");

    const paramKeys = Object.keys(p.params);
    if (paramKeys.length > 0) {
      lines.push(`<details><summary>Parameters</summary>`);
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(p.params, null, 2));
      lines.push("```");
      lines.push("");
      lines.push(`</details>`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderEscalations(report: ShiftReport): string {
  const lines = [`## Escalations`];

  if (report.escalations.length === 0) {
    lines.push("", "_No escalations during this shift._");
    return lines.join("\n");
  }

  lines.push(
    "",
    `**${report.escalations.length}** escalation event(s) recorded:`,
    "",
  );
  lines.push(`| # | Time | Action | Agent | Outcome | Reasoning |`);
  lines.push(`|---|------|--------|-------|---------|-----------|`);

  for (let i = 0; i < report.escalations.length; i++) {
    const e = report.escalations[i];
    const reasonShort = truncate(e.reasoning, 60);
    lines.push(
      `| ${i + 1} | ${formatTimestamp(e.timestamp)} | \`${e.actionType}\` | \`${e.agentId}\` | ${e.outcome} | ${reasonShort} |`,
    );
  }

  return lines.join("\n");
}

function renderErrorsAndBlocks(report: ShiftReport): string {
  const lines = [`## Errors & Blocks`];

  if (report.errors.length === 0) {
    lines.push("", "_No rejected or blocked actions this shift._");
    return lines.join("\n");
  }

  lines.push(
    "",
    `**${report.errors.length}** action(s) were rejected or blocked:`,
    "",
  );
  lines.push(`| # | Time | Action | Outcome | Reason |`);
  lines.push(`|---|------|--------|---------|--------|`);

  for (let i = 0; i < report.errors.length; i++) {
    const e = report.errors[i];
    const reasonShort = truncate(e.reason, 80);
    lines.push(
      `| ${i + 1} | ${formatTimestamp(e.timestamp)} | \`${e.actionType}\` | ${e.outcome} | ${reasonShort} |`,
    );
  }

  return lines.join("\n");
}

function renderTokenUsage(report: ShiftReport): string {
  const t = report.tokenUsage;

  const lines = [
    `## Token Usage`,
    "",
    `| Metric | Value |`,
    `|--------|------:|`,
    `| **Total Input Tokens** | ${formatNumber(t.totalInput)} |`,
    `| **Total Output Tokens** | ${formatNumber(t.totalOutput)} |`,
    `| **Total Tokens** | **${formatNumber(t.totalTokens)}** |`,
    `| **Estimated Cost** | **$${t.estimatedCostUsd.toFixed(4)}** |`,
  ];

  const models = Object.entries(t.byModel);
  if (models.length > 0) {
    lines.push("");
    lines.push(`### By Model`);
    lines.push("");
    lines.push(`| Model | Input | Output | Total |`);
    lines.push(`|-------|------:|-------:|------:|`);

    for (const [model, usage] of models) {
      const total = usage.input + usage.output;
      lines.push(
        `| \`${model}\` | ${formatNumber(usage.input)} | ${formatNumber(usage.output)} | ${formatNumber(total)} |`,
      );
    }
  }

  return lines.join("\n");
}

function renderRecommendations(report: ShiftReport): string {
  const lines = [`## Recommendations`];

  if (report.recommendations.length === 0) {
    lines.push("", "_No recommendations._");
    return lines.join("\n");
  }

  lines.push("");
  for (const rec of report.recommendations) {
    lines.push(`- ${rec}`);
  }

  return lines.join("\n");
}

function renderFooter(report: ShiftReport): string {
  return [
    `_Report generated by Sisyphus AI Dispatcher v0.1.0_`,
    `_${formatTimestamp(report.generatedAt)}_`,
  ].join("  \n");
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-AU", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Australia/Sydney",
    });
  } catch {
    return iso;
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function tierBadge(tier: string): string {
  switch (tier.toUpperCase()) {
    case "RED":
      return "RED";
    case "ORANGE":
      return "ORANGE";
    case "YELLOW":
      return "YELLOW";
    case "GREEN":
      return "GREEN";
    default:
      return tier;
  }
}

function tierOrder(tier: string): number {
  switch (tier.toUpperCase()) {
    case "RED":
      return 4;
    case "ORANGE":
      return 3;
    case "YELLOW":
      return 2;
    case "GREEN":
      return 1;
    default:
      return 0;
  }
}
