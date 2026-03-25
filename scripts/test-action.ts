#!/usr/bin/env tsx
/**
 * CLI tool to test a single action against fake data.
 *
 * Sets up an OntologyStore with sample data, registers all actions,
 * creates a mock Redis, and runs the action through the full guardrails
 * execution pipeline. Prints the outcome, reason, and audit record.
 *
 * Usage:
 *   tsx scripts/test-action.ts AssignDriverToOrder '{"orderId":"a1b2c3d4-0001-4000-8000-000000000001","driverId":"driver-a@test.com"}'
 *   tsx scripts/test-action.ts AddTicketNote '{"ticketId":"tkt-0001","note":"Investigating this issue."}'
 *   tsx scripts/test-action.ts CancelOrder '{"orderId":"a1b2c3d4-0001-4000-8000-000000000001","reason":"Customer request","cancellationOwner":"Customer"}'
 */

import { OntologyStore } from "../src/ontology/state/store.js";
import { registerAllActions } from "../src/ontology/actions/index.js";
import { listActions, clearActions } from "../src/guardrails/registry.js";
import { executeAction } from "../src/guardrails/executor.js";
import type { AuditRecord } from "../src/guardrails/types.js";
import { createMockRedis } from "../tests/helpers/mock-redis.js";
import {
  transformOrder,
  transformDriver,
  transformMarket,
  transformRestaurant,
  transformTicket,
} from "../src/ontology/sync/transformer.js";

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log("");
  console.log(c.bold("  Sisyphus Action Tester"));
  console.log("");
  console.log("  Usage:");
  console.log('    tsx scripts/test-action.ts <ActionName> \'<JSON params>\'');
  console.log("");
  console.log("  Examples:");
  console.log(`    tsx scripts/test-action.ts AssignDriverToOrder '${JSON.stringify({ orderId: "a1b2c3d4-0001-4000-8000-000000000001", driverId: "driver-a@test.com" })}'`);
  console.log(`    tsx scripts/test-action.ts AddTicketNote '${JSON.stringify({ ticketId: "tkt-0001", note: "Investigating." })}'`);
  console.log("");

  // List available actions
  clearActions();
  await registerAllActions();
  const actions = listActions();
  console.log(`  Available actions (${actions.length}):`);
  for (const action of actions) {
    console.log(`    - ${c.cyan(action.name)} ${c.dim(`(${action.tier}, ${action.execution})`)}`);
  }
  console.log("");
  process.exit(0);
}

const actionName = args[0];
let params: Record<string, unknown>;

try {
  params = JSON.parse(args[1]);
} catch (err) {
  console.error(c.red("\n  Error: Invalid JSON params."));
  console.error(c.dim(`  Input: ${args[1]}`));
  console.error(c.dim(`  ${err}`));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build fake store with sample data
// ---------------------------------------------------------------------------

const NOW = Math.floor(Date.now() / 1000);

function buildStore(): OntologyStore {
  const store = new OntologyStore();

  store.updateOrders([
    transformOrder({
      OrderId: "a1b2c3d4-0001-4000-8000-000000000001",
      OrderStatus: "Pending",
      OrderType: "Delivery",
      UserId: "customer@test.com",
      DriverId: null,
      RestaurantId: "r1b2c3d4-0001-4000-8000-000000000001",
      RestaurantName: "Test Restaurant",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 300,
      OrderPlacedTime: NOW - 300,
      OrderSubtotal: 2000,
      Tax: 260,
      DeliveryFee: 499,
      Tip: 200,
      OrderTotal: 2959,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "a1b2c3d4-0002-4000-8000-000000000002",
      OrderStatus: "Confirmed",
      OrderType: "Delivery",
      UserId: "customer2@test.com",
      DriverId: "driver-a@test.com",
      RestaurantId: "r1b2c3d4-0001-4000-8000-000000000001",
      RestaurantName: "Test Restaurant",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 900,
      OrderPlacedTime: NOW - 900,
      DriverAssignedTime: NOW - 600,
      OrderSubtotal: 1500,
      Tax: 195,
      DeliveryFee: 499,
      Tip: 100,
      OrderTotal: 2294,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "a1b2c3d4-0003-4000-8000-000000000003",
      OrderStatus: "Completed",
      OrderType: "Delivery",
      UserId: "customer3@test.com",
      DriverId: "driver-b@test.com",
      RestaurantId: "r1b2c3d4-0001-4000-8000-000000000001",
      RestaurantName: "Test Restaurant",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 7200,
      OrderPlacedTime: NOW - 7200,
      OrderDeliveredTime: NOW - 3600,
      OrderSubtotal: 1800,
      Tax: 234,
      DeliveryFee: 499,
      Tip: 300,
      OrderTotal: 2833,
      ASAP: true,
      Alcohol: false,
    }),
  ]);

  store.updateDrivers([
    transformDriver({
      DriverId: "driver-a@test.com",
      FullName: "Test Driver A",
      Phone: "(613) 555-0001",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-a",
    }),
    transformDriver({
      DriverId: "driver-b@test.com",
      FullName: "Test Driver B",
      Phone: "(613) 555-0002",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: false,
      Paused: true,
      Active: true,
      ConnectionId: null,
    }),
  ]);

  store.updateMarkets([
    transformMarket({ Market: "Perth", Score: 40, idealDrivers: 2, drivers: 1, activeOrders: 2, ts: NOW }),
    transformMarket({ Market: "Pembroke", Score: 20, idealDrivers: 1, drivers: 1, activeOrders: 0, ts: NOW }),
  ]);

  store.updateRestaurants([
    transformRestaurant({
      RestaurantId: "r1b2c3d4-0001-4000-8000-000000000001",
      RestaurantName: "Test Restaurant",
      DeliveryZone: "Perth",
      Restaurant: true,
      DeliveryAvailable: true,
      LastHeartbeat: NOW - 10,
    }),
  ]);

  store.updateTickets([
    transformTicket({
      IssueId: "tkt-0001",
      Category: "Order Issue",
      IssueType: "Late Delivery",
      IssueStatus: "Pending",
      Created: NOW - 1200,
      OrderId: "a1b2c3d4-0002-4000-8000-000000000002",
      RestaurantId: "r1b2c3d4-0001-4000-8000-000000000001",
      RestaurantName: "Test Restaurant",
      Market: "Perth",
      Originator: "customer2@test.com",
      Owner: "Unassigned",
      Description: "Order taking too long.",
    }),
    transformTicket({
      IssueId: "tkt-0002",
      Category: "Driver Issue",
      IssueType: "Stale Driver Location",
      IssueStatus: "Resolved",
      Created: NOW - 7200,
      DriverId: "driver-b@test.com",
      Market: "Perth",
      Originator: "Supervisor",
      Owner: "agent@valleyeats.ca",
      Description: "Driver location stale.",
    }),
  ]);

  store.markSynced();
  return store;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("");
  console.log(c.bold("  Sisyphus Action Tester"));
  console.log(c.dim("  Testing action through the full guardrails pipeline."));
  console.log("");

  // Register actions
  clearActions();
  await registerAllActions();
  console.log(`  ${c.cyan(`${listActions().length} actions registered`)}`);

  // Build store and redis
  const store = buildStore();
  const redis = createMockRedis();
  const auditRecords: AuditRecord[] = [];

  console.log(`  ${c.cyan("Store populated with sample data")}`);
  console.log("");

  // Print what we're executing
  console.log(`  Action:  ${c.bold(actionName)}`);
  console.log(`  Params:  ${JSON.stringify(params, null, 2).split("\n").join("\n           ")}`);
  console.log("");

  // Execute
  const start = performance.now();
  const result = await executeAction(
    actionName,
    params,
    `CLI test of ${actionName}`,
    "cli-tester",
    {
      redis: redis as any,
      state: store as unknown as Record<string, unknown>,
      correlationId: `cli-test-${Date.now()}`,
      llmModel: "cli-test",
      llmTokensUsed: 0,
      onAudit: (record: AuditRecord) => {
        auditRecords.push(record);
      },
    },
  );
  const elapsed = (performance.now() - start).toFixed(1);

  // Print result
  console.log("  " + "=".repeat(60));
  console.log(c.bold("  Result"));
  console.log("  " + "=".repeat(60));
  console.log("");

  const outcomeColor =
    result.outcome === "executed" ? c.green
      : result.outcome === "staged" ? c.yellow
        : c.red;

  console.log(`  Success:   ${result.success ? c.green("true") : c.red("false")}`);
  console.log(`  Outcome:   ${outcomeColor(result.outcome)}`);
  if (result.reason) {
    console.log(`  Reason:    ${result.reason}`);
  }
  if (result.data) {
    console.log(`  Data:      ${JSON.stringify(result.data)}`);
  }
  console.log(`  Time:      ${elapsed}ms`);

  // Print audit record if available
  if (auditRecords.length > 0) {
    const audit = auditRecords[0];
    console.log("");
    console.log(c.bold("  Audit Record"));
    console.log("  " + "-".repeat(60));
    console.log(`  ID:                ${c.dim(audit.id)}`);
    console.log(`  Action:            ${audit.actionType}`);
    console.log(`  Agent:             ${audit.agentId}`);
    console.log(`  Outcome:           ${outcomeColor(audit.outcome)}`);
    console.log(`  Execution Time:    ${audit.executionTimeMs}ms`);
    console.log(`  Correlation ID:    ${c.dim(audit.correlationId)}`);
    console.log(`  Side Effects:      ${audit.sideEffectsFired.length > 0 ? audit.sideEffectsFired.join(", ") : c.dim("none")}`);

    // Submission criteria results
    const criteriaEntries = Object.entries(audit.submissionCheck);
    if (criteriaEntries.length > 0) {
      console.log("");
      console.log(c.bold("  Submission Criteria"));
      for (const [name, result] of criteriaEntries) {
        const res = result as { passed: boolean; message?: string };
        const icon = res.passed ? c.green("PASS") : c.red("FAIL");
        const msg = res.message ? ` -- ${res.message}` : "";
        console.log(`    ${icon}  ${name}${c.dim(msg)}`);
      }
    }
  }

  console.log("");
}

main().catch((err) => {
  console.error(c.red("\n  Error:"), err);
  process.exit(1);
});
