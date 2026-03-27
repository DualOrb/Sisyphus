#!/usr/bin/env tsx
/**
 * Generate a sample Sisyphus shift report.
 *
 * Creates realistic fake shift data (mirroring the simulation scenarios),
 * runs it through the report generator, and writes both Markdown and JSON
 * versions to the `reports/` directory.
 *
 * Usage:
 *   tsx scripts/generate-report.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { generateShiftReport } from "../src/shift/report.js";
import { formatReportAsMarkdown } from "../src/shift/report-formatter.js";
import { formatReportAsJson } from "../src/shift/report-formatter-json.js";
import type { ShiftStats } from "../src/shift/activities.js";
import type { Proposal } from "../src/execution/shadow/executor.js";
import type { ShadowSummary } from "../src/execution/shadow/metrics.js";
import type { AuditRecord, ActionOutcome } from "../src/guardrails/types.js";
import type { UsageSummary } from "../src/llm/token-tracker.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const reportsDir = resolve(__dirname, "..", "reports");

// ---------------------------------------------------------------------------
// Fake data generators
// ---------------------------------------------------------------------------

const NOW = new Date();
const SHIFT_START = new Date(NOW.getTime() - 4 * 60 * 60 * 1000); // 4 hours ago

function ts(minutesAgo: number): Date {
  return new Date(NOW.getTime() - minutesAgo * 60 * 1000);
}

function fakeShiftStats(): ShiftStats {
  return {
    shiftStartedAt: SHIFT_START.toISOString(),
    dispatchCycles: 48,
    ontologySyncs: 96,
    actionsExecuted: 34,
    errorsEncountered: 3,
    browserReconnections: 1,
  };
}

function fakeProposals(): Proposal[] {
  const proposals: Proposal[] = [
    // RED tier — escalation for unresponsive driver with multiple orders
    {
      id: randomUUID(),
      timestamp: ts(180),
      actionName: "EscalateToHumanDispatcher",
      params: {
        driverId: "driver-ghost@test.com",
        reason: "Driver unresponsive for 25 minutes with 3 active orders",
        market: "Perth",
        activeOrders: ["ORD-2001", "ORD-2002", "ORD-2003"],
      },
      tier: "RED",
      wouldExecuteVia: "internal",
      reasoning:
        "Driver has not responded to pings for 25 min. Three customers waiting. " +
        "Escalating to human dispatcher for immediate reassignment.",
      agentId: "driver-monitor",
      validationResult: { passed: true },
    },
    // RED tier — cancel & refund for stale order
    {
      id: randomUUID(),
      timestamp: ts(120),
      actionName: "CancelOrder",
      params: {
        orderId: "ORD-3050",
        reason: "Restaurant closed unexpectedly — no driver can fulfil",
        market: "Pembroke",
      },
      tier: "RED",
      wouldExecuteVia: "api",
      reasoning:
        "Restaurant Heartbeat lost 40 min ago. Order cannot be fulfilled. " +
        "Recommending cancel with full refund.",
      agentId: "order-manager",
      validationResult: { passed: true },
    },
    // ORANGE tier — reassign order from paused driver
    {
      id: randomUUID(),
      timestamp: ts(150),
      actionName: "AssignDriverToOrder",
      params: {
        orderId: "ORD-2001",
        driverId: "driver-speedy@test.com",
        market: "Perth",
      },
      tier: "ORANGE",
      wouldExecuteVia: "browser",
      reasoning:
        "Original driver paused. Reassigning to Speedy Steve who is 2 km away.",
      agentId: "order-manager",
      validationResult: { passed: true },
    },
    // ORANGE tier — adjust delivery zone
    {
      id: randomUUID(),
      timestamp: ts(90),
      actionName: "AdjustDeliveryZone",
      params: {
        market: "Perth",
        expandRadiusKm: 3,
        reason: "Driver shortage in core zone — expanding to capture nearby drivers",
      },
      tier: "ORANGE",
      wouldExecuteVia: "api",
      reasoning:
        "Perth has 8 pending orders but only 2 active drivers. Expanding zone radius " +
        "to pull in drivers from adjacent areas.",
      agentId: "supervisor",
      validationResult: { passed: true },
    },
    // YELLOW tier — message driver
    {
      id: randomUUID(),
      timestamp: ts(170),
      actionName: "SendDriverMessage",
      params: {
        driverId: "driver-ghost@test.com",
        message:
          "Hi, are you still active? You have 3 orders assigned. Please confirm.",
        relatedOrderId: "ORD-2001",
        market: "Perth",
      },
      tier: "YELLOW",
      wouldExecuteVia: "browser",
      reasoning: "First ping to unresponsive driver before escalating.",
      agentId: "driver-monitor",
      validationResult: { passed: true },
    },
    // YELLOW tier — add ticket note
    {
      id: randomUUID(),
      timestamp: ts(60),
      actionName: "AddTicketNote",
      params: {
        ticketId: "TKT-4421",
        note: "Customer confirmed they received a partial order. Missing item: Large Fries. Issuing partial refund.",
        market: "Pembroke",
      },
      tier: "YELLOW",
      wouldExecuteVia: "browser",
      reasoning:
        "Documenting investigation results on missing item ticket.",
      agentId: "ticket-resolver",
      validationResult: { passed: true },
    },
    // GREEN tier — routine assignment
    {
      id: randomUUID(),
      timestamp: ts(200),
      actionName: "AssignDriverToOrder",
      params: {
        orderId: "ORD-1001",
        driverId: "driver-happy-a@test.com",
        market: "Perth",
        deliveryZone: "Perth",
      },
      tier: "GREEN",
      wouldExecuteVia: "browser",
      reasoning:
        "Routine assignment — order is 2 min old, driver is closest available.",
      agentId: "order-manager",
      validationResult: { passed: true },
    },
    {
      id: randomUUID(),
      timestamp: ts(195),
      actionName: "AssignDriverToOrder",
      params: {
        orderId: "ORD-1002",
        driverId: "driver-happy-b@test.com",
        deliveryZone: "Pembroke",
      },
      tier: "GREEN",
      wouldExecuteVia: "browser",
      reasoning: "Fresh order, Jane is the only driver in Pembroke.",
      agentId: "order-manager",
      validationResult: { passed: true },
    },
    {
      id: randomUUID(),
      timestamp: ts(185),
      actionName: "SendDriverMessage",
      params: {
        driverId: "driver-happy-a@test.com",
        message: "New pickup at Healthy Bowl for order ORD-1001.",
        relatedOrderId: "ORD-1001",
        market: "Perth",
      },
      tier: "GREEN",
      wouldExecuteVia: "browser",
      reasoning: "Notifying driver of new pickup.",
      agentId: "order-manager",
      validationResult: { passed: true },
    },
    // GREEN tier — another message
    {
      id: randomUUID(),
      timestamp: ts(160),
      actionName: "SendDriverMessage",
      params: {
        driverId: "driver-speedy@test.com",
        message: "Heads up: order ORD-2001 was reassigned to you from another driver.",
        relatedOrderId: "ORD-2001",
        market: "Perth",
      },
      tier: "GREEN",
      wouldExecuteVia: "browser",
      reasoning: "Informing replacement driver about the reassignment.",
      agentId: "order-manager",
      validationResult: { passed: true },
    },
    // Failed validation
    {
      id: randomUUID(),
      timestamp: ts(130),
      actionName: "AssignDriverToOrder",
      params: {
        orderId: "ORD-9999",
        driverId: "driver-inactive@test.com",
        market: "Perth",
      },
      tier: "GREEN",
      wouldExecuteVia: "browser",
      reasoning: "Attempting to assign inactive driver — should fail validation.",
      agentId: "order-manager",
      validationResult: {
        passed: false,
        errors: [
          { rule: "DriverAvailable", message: "Driver is not currently active" },
        ],
      },
    },
    // More GREEN actions for volume
    {
      id: randomUUID(),
      timestamp: ts(100),
      actionName: "AssignDriverToOrder",
      params: {
        orderId: "ORD-1010",
        driverId: "driver-happy-c@test.com",
        deliveryZone: "Perth",
      },
      tier: "GREEN",
      wouldExecuteVia: "browser",
      reasoning: "Standard assignment — Carlos is available.",
      agentId: "order-manager",
      validationResult: { passed: true },
    },
    {
      id: randomUUID(),
      timestamp: ts(80),
      actionName: "SendDriverMessage",
      params: {
        driverId: "driver-happy-c@test.com",
        message: "New pickup at Burger Barn for order ORD-1010.",
        relatedOrderId: "ORD-1010",
        market: "Perth",
      },
      tier: "GREEN",
      wouldExecuteVia: "browser",
      reasoning: "Standard pickup notification.",
      agentId: "order-manager",
      validationResult: { passed: true },
    },
    {
      id: randomUUID(),
      timestamp: ts(45),
      actionName: "AddTicketNote",
      params: {
        ticketId: "TKT-4430",
        note: "Verified delivery photo. Order was left at correct address. Closing ticket.",
        market: "Perth",
      },
      tier: "GREEN",
      wouldExecuteVia: "browser",
      reasoning: "Routine ticket resolution — photo verification complete.",
      agentId: "ticket-resolver",
      validationResult: { passed: true },
    },
  ];

  return proposals;
}

function fakeMetrics(proposals: Proposal[]): ShadowSummary {
  const byAction: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  let passed = 0;
  let failed = 0;

  for (const p of proposals) {
    byAction[p.actionName] = (byAction[p.actionName] ?? 0) + 1;
    byTier[p.tier] = (byTier[p.tier] ?? 0) + 1;
    byMethod[p.wouldExecuteVia] = (byMethod[p.wouldExecuteVia] ?? 0) + 1;
    if (p.agentId) {
      byAgent[p.agentId] = (byAgent[p.agentId] ?? 0) + 1;
    }
    if (p.validationResult) {
      if (p.validationResult.passed) passed++;
      else failed++;
    }
  }

  return {
    totalProposals: proposals.length,
    byAction,
    byTier,
    byValidation: { passed, failed },
    byAgent,
    byMethod,
  };
}

function fakeAuditRecords(): AuditRecord[] {
  const records: AuditRecord[] = [
    // Executed actions
    ...["ORD-1001", "ORD-1002", "ORD-1010"].map(
      (orderId, i) =>
        ({
          id: randomUUID(),
          timestamp: ts(200 - i * 10),
          actionType: "AssignDriverToOrder",
          agentId: "order-manager",
          params: { orderId, driverId: `driver-${i}@test.com` },
          reasoning: "Routine order assignment.",
          submissionCheck: { OrderExists: { passed: true }, DriverAvailable: { passed: true } },
          outcome: "executed" as ActionOutcome,
          beforeState: { orderStatus: "Pending" },
          afterState: { orderStatus: "Confirmed" },
          sideEffectsFired: ["order.assigned", "driver.notified"],
          executionTimeMs: 120 + i * 15,
          llmModel: "local-default",
          llmTokensUsed: 450 + i * 50,
          correlationId: `shift-${SHIFT_START.toISOString()}`,
        }) satisfies AuditRecord,
    ),
    // Staged for review
    {
      id: randomUUID(),
      timestamp: ts(180),
      actionType: "EscalateToHumanDispatcher",
      agentId: "driver-monitor",
      params: { driverId: "driver-ghost@test.com", reason: "Unresponsive 25 min" },
      reasoning: "Driver unresponsive. Escalating.",
      submissionCheck: {},
      outcome: "staged",
      beforeState: {},
      afterState: {},
      sideEffectsFired: [],
      executionTimeMs: 45,
      llmModel: "cloud-fallback",
      llmTokensUsed: 1200,
      correlationId: `shift-${SHIFT_START.toISOString()}`,
    },
    {
      id: randomUUID(),
      timestamp: ts(120),
      actionType: "CancelOrder",
      agentId: "order-manager",
      params: { orderId: "ORD-3050", reason: "Restaurant closed" },
      reasoning: "Restaurant heartbeat lost. Cancel recommended.",
      submissionCheck: {},
      outcome: "staged",
      beforeState: { orderStatus: "Pending" },
      afterState: {},
      sideEffectsFired: [],
      executionTimeMs: 38,
      llmModel: "cloud-fallback",
      llmTokensUsed: 950,
      correlationId: `shift-${SHIFT_START.toISOString()}`,
    },
    // Rejected — assignment to completed order
    {
      id: randomUUID(),
      timestamp: ts(130),
      actionType: "AssignDriverToOrder",
      agentId: "order-manager",
      params: { orderId: "ORD-9999", driverId: "driver-inactive@test.com" },
      reasoning: "Attempting assignment — should be rejected.",
      submissionCheck: {
        DriverAvailable: { passed: false, message: "Driver is not currently active" },
      },
      outcome: "rejected",
      beforeState: {},
      afterState: {},
      sideEffectsFired: [],
      executionTimeMs: 12,
      llmModel: "local-default",
      llmTokensUsed: 380,
      correlationId: `shift-${SHIFT_START.toISOString()}`,
    },
    // Cooldown blocked
    {
      id: randomUUID(),
      timestamp: ts(165),
      actionType: "SendDriverMessage",
      agentId: "driver-monitor",
      params: {
        driverId: "driver-ghost@test.com",
        message: "Second ping within cooldown",
        market: "Perth",
      },
      reasoning: "Follow-up ping to unresponsive driver — hit cooldown.",
      submissionCheck: {},
      outcome: "cooldown_blocked",
      beforeState: {},
      afterState: {},
      sideEffectsFired: [],
      executionTimeMs: 5,
      llmModel: "local-default",
      llmTokensUsed: 200,
      correlationId: `shift-${SHIFT_START.toISOString()}`,
    },
    // More executed actions (messages, ticket notes)
    {
      id: randomUUID(),
      timestamp: ts(185),
      actionType: "SendDriverMessage",
      agentId: "order-manager",
      params: { driverId: "driver-happy-a@test.com", message: "Pickup at Healthy Bowl" },
      reasoning: "Notifying driver.",
      submissionCheck: { DriverExists: { passed: true } },
      outcome: "executed",
      beforeState: {},
      afterState: {},
      sideEffectsFired: ["driver.messaged"],
      executionTimeMs: 95,
      llmModel: "local-default",
      llmTokensUsed: 320,
      correlationId: `shift-${SHIFT_START.toISOString()}`,
    },
    {
      id: randomUUID(),
      timestamp: ts(60),
      actionType: "AddTicketNote",
      agentId: "ticket-resolver",
      params: { ticketId: "TKT-4421", note: "Partial refund for missing item." },
      reasoning: "Documenting resolution.",
      submissionCheck: { TicketExists: { passed: true } },
      outcome: "executed",
      beforeState: { ticketStatus: "Pending" },
      afterState: { ticketStatus: "Pending" },
      sideEffectsFired: ["ticket.noted"],
      executionTimeMs: 110,
      llmModel: "local-default",
      llmTokensUsed: 280,
      correlationId: `shift-${SHIFT_START.toISOString()}`,
    },
    {
      id: randomUUID(),
      timestamp: ts(45),
      actionType: "AddTicketNote",
      agentId: "ticket-resolver",
      params: { ticketId: "TKT-4430", note: "Photo verified. Closing." },
      reasoning: "Routine closure.",
      submissionCheck: { TicketExists: { passed: true } },
      outcome: "executed",
      beforeState: { ticketStatus: "Pending" },
      afterState: { ticketStatus: "Resolved" },
      sideEffectsFired: ["ticket.noted"],
      executionTimeMs: 88,
      llmModel: "local-default",
      llmTokensUsed: 250,
      correlationId: `shift-${SHIFT_START.toISOString()}`,
    },
  ];

  return records;
}

function fakeTokenUsage(): { summary: UsageSummary; cost: number } {
  const summary: UsageSummary = {
    totalInput: 42_350,
    totalOutput: 8_720,
    byModel: {
      "local-default": { input: 35_800, output: 6_200 },
      "anthropic/claude-sonnet-4": { input: 6_550, output: 2_520 },
    },
  };

  // Local is free; cloud costs ~$3/M in + $15/M out
  const cost =
    (6_550 / 1_000_000) * 3.0 + (2_520 / 1_000_000) * 15.0;

  return { summary, cost };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log("\n  Sisyphus Shift Report Generator\n");

  // Generate fake data
  const shiftStats = fakeShiftStats();
  const proposals = fakeProposals();
  const metrics = fakeMetrics(proposals);
  const auditRecords = fakeAuditRecords();
  const { summary: tokenSummary, cost: estimatedCost } = fakeTokenUsage();

  console.log(`  Shift start:       ${shiftStats.shiftStartedAt}`);
  console.log(`  Proposals:         ${proposals.length}`);
  console.log(`  Audit records:     ${auditRecords.length}`);
  console.log(`  Dispatch cycles:   ${shiftStats.dispatchCycles}`);
  console.log(`  Ontology syncs:    ${shiftStats.ontologySyncs}`);
  console.log("");

  // Generate the report
  const report = generateShiftReport({
    shiftStats,
    proposals,
    metrics,
    auditRecords,
    tokenUsage: tokenSummary,
    estimatedCostUsd: estimatedCost,
    operatingMode: "shadow",
  });

  // Format
  const markdown = formatReportAsMarkdown(report);
  const json = formatReportAsJson(report);

  // Ensure reports/ directory exists
  mkdirSync(reportsDir, { recursive: true });

  // Write files
  const mdPath = resolve(reportsDir, "sample-shift-report.md");
  const jsonPath = resolve(reportsDir, "sample-shift-report.json");

  writeFileSync(mdPath, markdown, "utf-8");
  writeFileSync(jsonPath, json, "utf-8");

  console.log(`  Written: ${mdPath}`);
  console.log(`  Written: ${jsonPath}`);
  console.log("");
  console.log(`  Markdown report: ${markdown.split("\n").length} lines`);
  console.log(`  JSON report:     ${json.length} bytes`);
  console.log("");

  // Print first ~30 lines of the markdown as a preview
  const preview = markdown.split("\n").slice(0, 30).join("\n");
  console.log("  --- Preview (first 30 lines) ---\n");
  console.log(preview);
  console.log("\n  --- End preview ---\n");
}

main();
