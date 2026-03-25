/**
 * Event-driven shadow watcher.
 *
 * Fetches dispatch.txt from S3 every 20s, diffs against previous state,
 * and only invokes the LLM when something actually needs attention.
 *
 * Also connects to the dispatch WebSocket for real-time driver messages.
 *
 * Run: npx tsx scripts/shadow-watch.ts
 * Stop: Ctrl+C
 */

import "dotenv/config";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

import { OntologyStore } from "../src/ontology/state/store.js";
import {
  transformOrder,
  transformDriver,
  transformMarket,
  transformTicket,
} from "../src/ontology/sync/transformer.js";
import { EventDetector } from "../src/events/detector.js";
import { EventQueue } from "../src/events/queue.js";
import { EventDispatcher } from "../src/events/dispatcher.js";
import { callLlm } from "../src/llm/client.js";
import { tokenTracker } from "../src/llm/client.js";
import type { PrioritizedEvent } from "../src/events/types.js";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const s3 = new S3Client({ region: REGION });
const dynamo = new DynamoDBClient({ region: REGION });

const POLL_INTERVAL_MS = 20_000; // 20 seconds — matches dispatch.txt update frequency
const HEARTBEAT_INTERVAL_MS = 90_000; // 90 seconds — background health check
const LLM_COOLDOWN_MS = 30_000; // Don't call LLM more than once per 30s

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentStore = new OntologyStore();
let previousStore: OntologyStore | null = null;
let lastLlmCall = 0;
let totalLlmCalls = 0;
let totalEventsProcessed = 0;
let cycleCount = 0;
const startTime = Date.now();

// Two hardcoded restaurant IDs to exclude (from dispatch page code)
const EXCLUDED_RESTAURANTS = new Set([
  "ab8a647e-4c41-4afb-9a93-9da5fdffe93d",
  "70b13a1d-24b1-4114-8662-6854bfa38591",
]);

// ---------------------------------------------------------------------------
// Fetch dispatch.txt from S3
// ---------------------------------------------------------------------------

async function fetchDispatchFile(): Promise<any> {
  const result = await s3.send(
    new GetObjectCommand({ Bucket: "valleyeats", Key: "dispatch.txt" }),
  );
  const body = await result.Body?.transformToString();
  if (!body) throw new Error("Empty dispatch.txt");
  return JSON.parse(body);
}

// ---------------------------------------------------------------------------
// Parse dispatch.txt into ontology objects
// ---------------------------------------------------------------------------

function parseDispatchData(data: any): {
  orders: any[];
  drivers: any[];
  markets: any[];
  timestamp: number;
} {
  const zones = Object.keys(data).filter((k) => k !== "Timestamp");
  const orders: any[] = [];
  const drivers: any[] = [];
  const markets: any[] = [];

  for (const zone of zones) {
    const zoneData = data[zone];

    // Drivers
    if (zoneData.Drivers) {
      for (const d of zoneData.Drivers) {
        try {
          drivers.push(transformDriver({
            ...d,
            DispatchZone: d.DispatchZone ?? zone,
            DeliveryArea: d.DeliveryArea ?? zone,
            Active: d.Active ?? true,
          }));
        } catch { /* skip bad records */ }
      }
    }

    // Orders
    if (zoneData.Orders) {
      for (const o of zoneData.Orders) {
        if (EXCLUDED_RESTAURANTS.has(o.RestaurantId)) continue;
        try {
          orders.push(transformOrder({
            ...o,
            DeliveryZone: o.DeliveryZone ?? zone,
          }));
        } catch { /* skip bad records */ }
      }
    }

    // Markets (from Meter data)
    if (zoneData.Meter) {
      try {
        markets.push(transformMarket({
          Market: zone,
          ...zoneData.Meter,
        }));
      } catch { /* skip */ }
    }
  }

  return { orders, drivers, markets, timestamp: data.Timestamp };
}

// ---------------------------------------------------------------------------
// Diff detection
// ---------------------------------------------------------------------------

function detectChanges(
  current: OntologyStore,
  previous: OntologyStore | null,
): { newOrders: number; statusChanges: number; driverChanges: number } {
  if (!previous) return { newOrders: 0, statusChanges: 0, driverChanges: 0 };

  let newOrders = 0;
  let statusChanges = 0;
  let driverChanges = 0;

  // Check for new orders or status changes
  const currentOrders = current.queryOrders({});
  for (const order of currentOrders) {
    const prev = previous.getOrder(order.orderId);
    if (!prev) {
      newOrders++;
    } else if (prev.status !== order.status) {
      statusChanges++;
    }
  }

  // Check for driver state changes
  const currentDrivers = current.queryDrivers({});
  for (const driver of currentDrivers) {
    const prev = previous.getDriver(driver.driverId);
    if (!prev) continue;
    if (prev.isOnline !== driver.isOnline || prev.isPaused !== driver.isPaused) {
      driverChanges++;
    }
  }

  return { newOrders, statusChanges, driverChanges };
}

// ---------------------------------------------------------------------------
// Format situation for LLM
// ---------------------------------------------------------------------------

function buildSituationReport(store: OntologyStore, events: PrioritizedEvent[]): string {
  const stats = store.getStats();
  const allOrders = store.queryOrders({});
  const allDrivers = store.queryDrivers({});
  const allMarkets = Array.from({ length: stats.markets }, (_, i) => {
    // Get markets from store — iterate known zone names
    return null;
  }).filter(Boolean);

  const onlineDrivers = allDrivers.filter((d) => d.isOnline);
  const placedOrders = store.queryOrders({ status: "Placed" });
  const confirmedOrders = store.queryOrders({ status: "Confirmed" });
  const readyOrders = store.queryOrders({ status: "Ready" });
  const inTransitOrders = store.queryOrders({ status: "InTransit" });
  const unassigned = allOrders.filter((o) => !o.driverId);

  const dispatcher = new EventDispatcher();

  const lines = [
    `SISYPHUS SHADOW DISPATCH — ${new Date().toISOString()}`,
    `Mode: SHADOW (analysis only, no real actions)`,
    ``,
    `ORDERS: ${allOrders.length} active (Placed: ${placedOrders.length}, Confirmed: ${confirmedOrders.length}, Ready: ${readyOrders.length}, InTransit: ${inTransitOrders.length})`,
    `  Unassigned: ${unassigned.length}`,
    `DRIVERS: ${allDrivers.length} in dispatch, ${onlineDrivers.length} on-shift`,
    ``,
  ];

  if (events.length > 0) {
    lines.push(`EVENTS REQUIRING ATTENTION:`);
    for (const e of events.slice(0, 8)) {
      lines.push(`  ${dispatcher.formatEventForAgent(e)}`);
    }
    if (events.length > 8) {
      lines.push(`  ... and ${events.length - 8} more`);
    }
  } else {
    lines.push(`No urgent events. Routine check — confirm all markets are healthy.`);
  }

  lines.push(``, `What actions would you take? Be specific with IDs and names.`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function pollCycle() {
  cycleCount++;
  const cycleStart = Date.now();

  try {
    // 1. Fetch dispatch.txt
    const data = await fetchDispatchFile();
    const { orders, drivers, markets, timestamp } = parseDispatchData(data);

    // 2. Save previous state, update current
    previousStore = currentStore;
    currentStore = new OntologyStore();
    currentStore.updateOrders(orders);
    currentStore.updateDrivers(drivers);
    currentStore.updateMarkets(markets);

    // 3. Detect changes from previous cycle
    const changes = detectChanges(currentStore, previousStore);
    const hasChanges = changes.newOrders > 0 || changes.statusChanges > 0 || changes.driverChanges > 0;

    // 4. Run event detector
    const detector = new EventDetector();
    const events = detector.detect(currentStore, previousStore ?? undefined);

    // 5. Log cycle
    const elapsed = Date.now() - cycleStart;
    const ts = new Date(timestamp * 1000).toLocaleTimeString();

    if (hasChanges || events.some((e) => e.priority === "critical" || e.priority === "high")) {
      console.log(
        `  \x1b[33m[${ts}]\x1b[0m ` +
        `Orders: ${orders.length} | Drivers: ${drivers.length} | ` +
        `Changes: +${changes.newOrders} new, ${changes.statusChanges} status, ${changes.driverChanges} driver | ` +
        `Events: ${events.length} (${events.filter((e) => e.priority === "high" || e.priority === "critical").length} urgent) | ` +
        `${elapsed}ms`
      );
    } else {
      // Quiet cycle — just a dot
      process.stdout.write(".");
    }

    // 6. Decide whether to invoke LLM
    const urgentEvents = events.filter((e) => e.priority === "critical" || e.priority === "high");
    const timeSinceLastLlm = Date.now() - lastLlmCall;
    const isHeartbeat = timeSinceLastLlm > HEARTBEAT_INTERVAL_MS;
    const hasUrgent = urgentEvents.length > 0;
    const hasSignificantChanges = changes.newOrders >= 2 || changes.statusChanges >= 3;

    const shouldInvokeLlm =
      (hasUrgent || hasSignificantChanges || isHeartbeat) &&
      timeSinceLastLlm > LLM_COOLDOWN_MS;

    if (shouldInvokeLlm) {
      const eventsForLlm = events.slice(0, 10);
      totalEventsProcessed += eventsForLlm.length;

      console.log(`\n  \x1b[36m→ Invoking LLM (${hasUrgent ? "URGENT" : isHeartbeat ? "heartbeat" : "changes"})...\x1b[0m`);

      const prompt = buildSituationReport(currentStore, eventsForLlm);

      const response = await callLlm([
        {
          role: "system",
          content:
            "You are Sisyphus, an AI dispatcher for ValleyEats. SHADOW MODE — describe what you WOULD do. " +
            "For each action: name, parameters (IDs/names), reasoning, priority. Be concise — 2-3 sentences per action max.",
        },
        { role: "user", content: prompt },
      ]);

      const content = response.choices[0]?.message?.content ?? "(no response)";
      lastLlmCall = Date.now();
      totalLlmCalls++;

      console.log(`  \x1b[32m── LLM Response (#${totalLlmCalls}) ──\x1b[0m`);
      console.log(content.split("\n").map((l: string) => `  ${l}`).join("\n"));
      console.log(`  \x1b[32m──────────────────────\x1b[0m\n`);
    }
  } catch (err: any) {
    console.error(`  \x1b[31mError:\x1b[0m ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

console.log("\n\x1b[1m  Sisyphus Shadow Watcher\x1b[0m");
console.log(`  Polling dispatch.txt every ${POLL_INTERVAL_MS / 1000}s`);
console.log(`  LLM heartbeat every ${HEARTBEAT_INTERVAL_MS / 1000}s`);
console.log(`  LLM cooldown: ${LLM_COOLDOWN_MS / 1000}s minimum between calls`);
console.log(`  Press Ctrl+C to stop\n`);

// Run immediately, then on interval
await pollCycle();
const interval = setInterval(() => pollCycle(), POLL_INTERVAL_MS);

// Graceful shutdown
process.on("SIGINT", () => {
  clearInterval(interval);
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const usage = tokenTracker.getSummary();
  console.log(`\n\n\x1b[1m  Shadow Watcher Summary\x1b[0m`);
  console.log(`  Duration: ${duration} minutes`);
  console.log(`  Cycles: ${cycleCount}`);
  console.log(`  LLM calls: ${totalLlmCalls}`);
  console.log(`  Events processed: ${totalEventsProcessed}`);
  console.log(`  Tokens: ${usage.totalInput + usage.totalOutput} total`);
  console.log(`  Est. cost: $${tokenTracker.estimateCost().toFixed(4)}`);
  console.log("");
  process.exit(0);
});
