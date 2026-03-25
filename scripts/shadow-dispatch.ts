/**
 * First real shadow dispatch cycle.
 *
 * Syncs ALL active data from DynamoDB → populates ontology → detects events →
 * runs one LLM-powered dispatch cycle via the supervisor agent → logs proposals.
 *
 * Run: npx tsx scripts/shadow-dispatch.ts
 *
 * Requirements:
 *   - Redis running (docker)
 *   - PostgreSQL running (docker)
 *   - AWS credentials configured
 *   - OpenRouter API key in .env
 */

import "dotenv/config";
import { DynamoDBClient, ScanCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

import { createRedisClient } from "../src/memory/redis/client.js";
import { OntologyStore } from "../src/ontology/state/store.js";
import {
  transformOrder,
  transformDriver,
  transformRestaurant,
  transformMarket,
  transformTicket,
  transformConversation,
} from "../src/ontology/sync/transformer.js";
import { EventDetector } from "../src/events/detector.js";
import { EventQueue } from "../src/events/queue.js";
import { EventDispatcher } from "../src/events/dispatcher.js";
import { registerAllActions } from "../src/ontology/actions/index.js";
import { clearActions } from "../src/guardrails/registry.js";
import { callLlm } from "../src/llm/client.js";
import { tokenTracker } from "../src/llm/client.js";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const dynamo = new DynamoDBClient({ region: REGION });

// ---------------------------------------------------------------------------
// DynamoDB helpers
// ---------------------------------------------------------------------------

async function scanAll(tableName: string, limit?: number): Promise<any[]> {
  const items: any[] = [];
  let lastKey: any = undefined;

  do {
    const result: any = await dynamo.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastKey,
        Limit: limit,
      }),
    );
    if (result.Items) {
      items.push(...result.Items.map((i: any) => unmarshall(i)));
    }
    lastKey = result.LastEvaluatedKey;

    // If we have a limit and we've reached it, stop
    if (limit && items.length >= limit) break;
  } while (lastKey);

  return items;
}

async function queryByStatus(tableName: string, status: string): Promise<any[]> {
  try {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "OrderStatus-OrderReadyTime-index",
        KeyConditionExpression: "OrderStatus = :status",
        ExpressionAttributeValues: { ":status": { S: status } },
        Limit: 100,
      }),
    );
    return (result.Items ?? []).map((i: any) => unmarshall(i));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n\x1b[1m  Sisyphus — First Shadow Dispatch Cycle\x1b[0m\n");

  const startTime = Date.now();

  // ---- 1. Sync from DynamoDB ------------------------------------------------
  console.log("  \x1b[36m[1/6]\x1b[0m Syncing from DynamoDB...");

  // Get active orders (Pending, Confirmed, Ready, EnRoute, InTransit)
  const activeStatuses = ["Pending", "Confirmed", "Ready", "EnRoute", "InTransit"];
  const orderArrays = await Promise.all(activeStatuses.map((s) => queryByStatus("ValleyEats-Orders", s)));
  const rawOrders = orderArrays.flat();
  console.log(`    → ${rawOrders.length} active orders (${activeStatuses.map((s, i) => `${s}: ${orderArrays[i].length}`).join(", ")})`);

  const rawDrivers = await scanAll("ValleyEats-Drivers");
  console.log(`    → ${rawDrivers.length} drivers`);

  const rawMarkets = await scanAll("ValleyEats-MarketMeters");
  console.log(`    → ${rawMarkets.length} markets`);

  const rawRestaurants = await scanAll("ValleyEats-Restaurants", 200);
  console.log(`    → ${rawRestaurants.length} restaurants (capped at 200)`);

  // Get recent tickets (New and Pending)
  let rawTickets: any[] = [];
  try {
    const newTickets = await dynamo.send(
      new QueryCommand({
        TableName: "ValleyEats-IssueTracker",
        IndexName: "IssueStatus-Created-index",
        KeyConditionExpression: "IssueStatus = :status",
        ExpressionAttributeValues: { ":status": { S: "New" } },
        Limit: 50,
      }),
    );
    const pendingTickets = await dynamo.send(
      new QueryCommand({
        TableName: "ValleyEats-IssueTracker",
        IndexName: "IssueStatus-Created-index",
        KeyConditionExpression: "IssueStatus = :status",
        ExpressionAttributeValues: { ":status": { S: "Pending" } },
        Limit: 50,
      }),
    );
    rawTickets = [
      ...(newTickets.Items ?? []).map((i: any) => unmarshall(i)),
      ...(pendingTickets.Items ?? []).map((i: any) => unmarshall(i)),
    ];
  } catch (err: any) {
    console.log(`    → Tickets: ${err.message}`);
  }
  console.log(`    → ${rawTickets.length} open tickets (New + Pending)`);

  // ---- 2. Populate ontology store -------------------------------------------
  console.log("\n  \x1b[36m[2/6]\x1b[0m Populating ontology store...");

  const store = new OntologyStore();

  const orders = rawOrders.map((o) => {
    try { return transformOrder(o); } catch { return null; }
  }).filter(Boolean) as any[];
  store.updateOrders(orders);

  const drivers = rawDrivers.map((d) => {
    try { return transformDriver(d); } catch { return null; }
  }).filter(Boolean) as any[];
  store.updateDrivers(drivers);

  const restaurants = rawRestaurants.map((r) => {
    try { return transformRestaurant(r); } catch { return null; }
  }).filter(Boolean) as any[];
  store.updateRestaurants(restaurants);

  const markets = rawMarkets.map((m) => {
    try { return transformMarket(m); } catch { return null; }
  }).filter(Boolean) as any[];
  store.updateMarkets(markets);

  const tickets = rawTickets.map((t) => {
    try { return transformTicket(t); } catch { return null; }
  }).filter(Boolean) as any[];
  store.updateTickets(tickets);

  const stats = store.getStats();
  console.log(`    → Store: ${stats.orders} orders, ${stats.drivers} drivers, ${stats.restaurants} restaurants, ${stats.markets} markets, ${stats.tickets} tickets`);

  // ---- 3. Detect events -----------------------------------------------------
  console.log("\n  \x1b[36m[3/6]\x1b[0m Detecting dispatch events...");

  const detector = new EventDetector();
  const events = detector.detect(store);
  const queue = new EventQueue();
  queue.enqueueAll(events);

  console.log(`    → ${events.length} events detected (queue size: ${queue.size})`);

  if (events.length > 0) {
    const byPriority: Record<string, number> = {};
    events.forEach((e) => {
      byPriority[e.priority] = (byPriority[e.priority] ?? 0) + 1;
    });
    console.log(`    → By priority: ${Object.entries(byPriority).map(([k, v]) => `${k}: ${v}`).join(", ")}`);

    // Show first 5 events
    const preview = events.slice(0, 5);
    console.log("    → Top events:");
    for (const e of preview) {
      const dispatcher = new EventDispatcher();
      console.log(`      [${e.priority.toUpperCase()}] ${dispatcher.formatEventForAgent(e)}`);
    }
  }

  // ---- 4. Format for LLM ---------------------------------------------------
  console.log("\n  \x1b[36m[4/6]\x1b[0m Building LLM prompt...");

  const dispatcher = new EventDispatcher();
  const eventsForCycle = queue.drain().slice(0, 10);

  // Build a comprehensive situation report
  const onlineDrivers = store.queryDrivers({ isAvailable: true });
  const pendingOrders = store.queryOrders({ status: "Pending" });
  const unassignedOrders = orders.filter((o: any) => !o.driverId && ["Pending", "Confirmed"].includes(o.status));

  const situationReport = [
    `SISYPHUS SHADOW DISPATCH CYCLE — ${new Date().toISOString()}`,
    ``,
    `MARKET OVERVIEW:`,
    ...markets.map((m: any) => `  ${m.market}: score=${m.score}, drivers=${m.availableDrivers}/${m.idealDrivers}, gap=${m.driverGap ?? 0}`),
    ``,
    `DRIVER STATUS:`,
    `  Total: ${drivers.length}, Available: ${onlineDrivers.length}`,
    `  Online: ${drivers.filter((d: any) => d.isOnline).length}`,
    ``,
    `ORDER STATUS:`,
    `  Active: ${orders.length} (Pending: ${pendingOrders.length}, Unassigned: ${unassignedOrders.length})`,
    ``,
    `OPEN TICKETS: ${tickets.length}`,
    ``,
  ].join("\n");

  let eventsMessage = "";
  if (eventsForCycle.length > 0) {
    eventsMessage = dispatcher.buildDispatchMessage(eventsForCycle);
  } else {
    eventsMessage = "No urgent events detected. Perform a routine health check of all markets.";
  }

  const fullPrompt = situationReport + "\n" + eventsMessage + "\n\nAnalyze the current situation. For each issue, state what action you would take and why. Be specific — reference order IDs, driver names, and market names.";

  console.log(`    → Prompt length: ${fullPrompt.length} chars`);
  console.log("    → Preview:");
  console.log(fullPrompt.split("\n").map((l) => `      ${l}`).join("\n"));

  // ---- 5. Call LLM ----------------------------------------------------------
  console.log("\n  \x1b[36m[5/6]\x1b[0m Calling LLM (shadow mode — no actions will execute)...");

  const response = await callLlm([
    {
      role: "system",
      content: [
        "You are Sisyphus, an AI dispatcher for ValleyEats food delivery.",
        "You are running in SHADOW MODE — analyze the situation and describe what actions you WOULD take.",
        "For each proposed action, specify:",
        "  1. Action name (e.g., AssignDriverToOrder, FlagMarketIssue, SendDriverMessage)",
        "  2. Parameters (order IDs, driver IDs, market names)",
        "  3. Reasoning (why this action)",
        "  4. Priority (critical/high/normal/low)",
        "",
        "Be concise and specific. Reference real IDs from the data provided.",
        "If nothing needs attention, say so.",
      ].join("\n"),
    },
    {
      role: "user",
      content: fullPrompt,
    },
  ]);

  const llmResponse = response.choices[0]?.message?.content ?? "(no response)";

  console.log("\n  \x1b[36m[6/6]\x1b[0m LLM Response (Shadow Proposals):");
  console.log("  ═══════════════════════════════════════════════════════════");
  console.log(llmResponse.split("\n").map((l: string) => `  ${l}`).join("\n"));
  console.log("  ═══════════════════════════════════════════════════════════");

  // ---- Summary --------------------------------------------------------------
  const duration = Date.now() - startTime;
  const usage = tokenTracker.getSummary();

  console.log("\n  \x1b[1mSummary\x1b[0m");
  console.log(`  Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log(`  Ontology: ${stats.orders} orders, ${stats.drivers} drivers, ${stats.markets} markets`);
  console.log(`  Events detected: ${events.length}`);
  console.log(`  Tokens: ${usage.totalInput} input + ${usage.totalOutput} output = ${usage.totalInput + usage.totalOutput} total`);
  console.log(`  Est. cost: $${tokenTracker.estimateCost().toFixed(4)}`);
  console.log("");

  // Clean up
  process.exit(0);
}

main().catch((err) => {
  console.error("\n  \x1b[31mFatal error:\x1b[0m", err.message ?? err);
  process.exit(1);
});
