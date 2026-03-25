#!/usr/bin/env tsx
/**
 * Sisyphus Simulation Harness
 *
 * Runs the full agent pipeline against realistic dispatch scenarios WITHOUT
 * any live infrastructure — no LLM, no dispatch API, no browser. Everything
 * is mocked in-memory.
 *
 * Usage:
 *   tsx scripts/simulate.ts            # run all scenarios
 *   tsx scripts/simulate.ts --verbose  # show full action results
 *   tsx scripts/simulate.ts --only "Happy Path"  # run one scenario by name
 *
 * What this tests:
 *   - Guardrails enforcement (submission criteria, cooldowns, tiers)
 *   - Ontology store population and querying
 *   - Action registry and Zod validation
 *   - Circuit breaker / rate limiter behavior
 *
 * What this does NOT test:
 *   - LLM reasoning (we call executeAction directly — no LLM in the loop)
 *   - Real browser/API execution (the executor is a no-op past guardrails)
 */

import { OntologyStore } from "../src/ontology/state/store.js";
import { registerAllActions } from "../src/ontology/actions/index.js";
import { listActions } from "../src/guardrails/registry.js";
import { executeAction } from "../src/guardrails/executor.js";
import type { ActionResult, AuditRecord } from "../src/guardrails/types.js";
import { createMockRedis } from "../tests/helpers/mock-redis.js";
import { ALL_SCENARIOS } from "./scenarios/index.js";
import type { Scenario, ScenarioAction } from "./scenarios/index.js";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const onlyIdx = args.indexOf("--only");
const onlyName = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_ID = "sisyphus-sim";
const DIVIDER = "=".repeat(80);
const THIN_DIVIDER = "-".repeat(80);

// ---------------------------------------------------------------------------
// Color helpers (ANSI escape codes for terminal output)
// ---------------------------------------------------------------------------

const color = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// Build the world-state snapshot that the guardrails executor needs
// ---------------------------------------------------------------------------

function buildWorldState(store: OntologyStore): Record<string, unknown> {
  // The submission criteria cast state back to OntologyStore, so we pass it
  // directly. This matches how the pipeline test and ontology-tools do it.
  return store as unknown as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Run a single scenario
// ---------------------------------------------------------------------------

interface ActionResultRow {
  label: string;
  actionName: string;
  expectedOutcome: string;
  actualOutcome: string;
  passed: boolean;
  reason?: string;
  executionMs: number;
}

async function runScenario(scenario: Scenario): Promise<ActionResultRow[]> {
  const store = new OntologyStore();
  const redis = createMockRedis();
  const auditRecords: AuditRecord[] = [];

  // Populate the store with scenario data
  scenario.setup(store);
  store.markSynced();

  const results: ActionResultRow[] = [];

  for (const action of scenario.actions) {
    const start = performance.now();

    const result: ActionResult = await executeAction(
      action.name,
      action.params,
      action.reasoning,
      AGENT_ID,
      {
        redis: redis as any,
        state: buildWorldState(store),
        correlationId: `sim-${scenario.name}`,
        llmModel: "simulation",
        llmTokensUsed: 0,
        onAudit: (record: AuditRecord) => {
          auditRecords.push(record);
        },
      },
    );

    const executionMs = performance.now() - start;

    results.push({
      label: action.label ?? action.name,
      actionName: action.name,
      expectedOutcome: action.expectedOutcome,
      actualOutcome: result.outcome,
      passed: result.outcome === action.expectedOutcome,
      reason: result.reason,
      executionMs,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Format and print results
// ---------------------------------------------------------------------------

function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : " ".repeat(len - s.length) + s;
}

function printScenarioResults(scenario: Scenario, rows: ActionResultRow[]): void {
  const passed = rows.filter((r) => r.passed).length;
  const total = rows.length;
  const allPassed = passed === total;

  console.log("");
  console.log(DIVIDER);
  console.log(
    `  ${color.bold(scenario.name)}  ${allPassed ? color.green(`[${passed}/${total} PASS]`) : color.red(`[${passed}/${total} PASS]`)}`,
  );
  console.log(`  ${color.dim(scenario.description)}`);
  console.log(DIVIDER);

  // Table header
  const colLabel = 44;
  const colExpected = 18;
  const colActual = 18;
  const colStatus = 6;
  const colMs = 8;

  console.log(
    `  ${padRight("Action", colLabel)} ${padRight("Expected", colExpected)} ${padRight("Actual", colActual)} ${padRight("", colStatus)} ${padLeft("ms", colMs)}`,
  );
  console.log(`  ${THIN_DIVIDER.slice(0, colLabel + colExpected + colActual + colStatus + colMs + 4)}`);

  for (const row of rows) {
    const statusStr = row.passed ? color.green("PASS") : color.red("FAIL");
    const actualStr = row.passed
      ? row.actualOutcome
      : color.red(row.actualOutcome);
    const msStr = row.executionMs.toFixed(1);

    console.log(
      `  ${padRight(row.label, colLabel)} ${padRight(row.expectedOutcome, colExpected)} ${padRight(actualStr, colActual + (row.passed ? 0 : 9))} ${padRight(statusStr, colStatus + 9)} ${padLeft(msStr, colMs)}`,
    );

    if (verbose && row.reason) {
      console.log(`    ${color.dim(row.reason)}`);
    }
    if (!row.passed && row.reason) {
      console.log(`    ${color.yellow("Reason: " + row.reason)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("");
  console.log(color.bold("  Sisyphus Simulation Harness"));
  console.log(color.dim("  Testing guardrails, ontology, and action pipeline without live infrastructure."));
  console.log("");

  // Ensure all actions are registered
  if (listActions().length === 0) {
    await registerAllActions();
  }

  const actionCount = listActions().length;
  console.log(`  ${color.cyan(`${actionCount} actions registered`)}`);

  // Filter scenarios if --only was specified
  const scenarios = onlyName
    ? ALL_SCENARIOS.filter((s) => s.name.toLowerCase().includes(onlyName.toLowerCase()))
    : ALL_SCENARIOS;

  if (scenarios.length === 0) {
    console.log(color.red(`\n  No scenarios matched "${onlyName}". Available:`));
    for (const s of ALL_SCENARIOS) {
      console.log(`    - ${s.name}`);
    }
    process.exit(1);
  }

  console.log(`  ${color.cyan(`${scenarios.length} scenario(s) to run`)}`);

  // Run each scenario
  let totalPassed = 0;
  let totalActions = 0;
  let scenariosPassed = 0;
  const scenarioResults: { scenario: Scenario; rows: ActionResultRow[] }[] = [];

  for (const scenario of scenarios) {
    const rows = await runScenario(scenario);
    scenarioResults.push({ scenario, rows });

    const passed = rows.filter((r) => r.passed).length;
    totalPassed += passed;
    totalActions += rows.length;
    if (passed === rows.length) scenariosPassed++;

    printScenarioResults(scenario, rows);
  }

  // Summary
  console.log("");
  console.log(DIVIDER);
  console.log(color.bold("  SUMMARY"));
  console.log(DIVIDER);
  console.log("");

  const allGood = totalPassed === totalActions;
  const scenarioSummary = `  Scenarios: ${scenariosPassed}/${scenarios.length} fully passed`;
  const actionSummary = `  Actions:   ${totalPassed}/${totalActions} passed`;

  console.log(allGood ? color.green(scenarioSummary) : color.yellow(scenarioSummary));
  console.log(allGood ? color.green(actionSummary) : color.yellow(actionSummary));

  // List any failures
  const failures = scenarioResults.flatMap(({ scenario, rows }) =>
    rows
      .filter((r) => !r.passed)
      .map((r) => ({ scenario: scenario.name, ...r })),
  );

  if (failures.length > 0) {
    console.log("");
    console.log(color.red("  Failures:"));
    for (const f of failures) {
      console.log(
        `    ${color.red("x")} ${f.scenario} > ${f.label}`,
      );
      console.log(
        `      expected ${color.green(f.expectedOutcome)}, got ${color.red(f.actualOutcome)}`,
      );
      if (f.reason) {
        console.log(`      ${color.dim(f.reason)}`);
      }
    }
  }

  console.log("");

  // Exit with failure code if any action failed
  if (!allGood) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(color.red("\n  Simulation crashed:"), err);
  process.exit(2);
});
