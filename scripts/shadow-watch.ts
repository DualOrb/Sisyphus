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
let latestDispatchData: any = null;
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

function formatTime(date: Date | null | undefined): string {
  if (!date || isNaN(date.getTime())) return "n/a";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Toronto" });
}

function minutesAgo(date: Date | null | undefined): string {
  if (!date || isNaN(date.getTime())) return "?";
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 0) return `in ${-mins}m`;
  if (mins === 0) return "now";
  return `${mins}m ago`;
}

function buildSituationReport(
  store: OntologyStore,
  dispatchData: any,
  events: PrioritizedEvent[],
): string {
  const allOrders = store.queryOrders({});
  const allDrivers = store.queryDrivers({});
  const zones = Object.keys(dispatchData).filter((k) => k !== "Timestamp");

  const lines: string[] = [
    `SISYPHUS SHADOW DISPATCH — ${new Date().toLocaleString("en-US", { timeZone: "America/Toronto" })}`,
    `Mode: SHADOW (analysis only — describe what you WOULD do, do not take actions)`,
    ``,
  ];

  // ── Per-market breakdown with orders and drivers ──
  for (const zone of zones) {
    const zoneData = dispatchData[zone];
    const zoneOrders = zoneData.Orders ?? [];
    const zoneDrivers = zoneData.Drivers ?? [];
    const meter = zoneData.Meter;
    const onShift = zoneDrivers.filter((d: any) => d.OnShift && !d.Paused);
    const paused = zoneDrivers.filter((d: any) => d.Paused);

    if (zoneOrders.length === 0 && onShift.length === 0) continue; // skip empty/inactive markets

    lines.push(`── ${zone} (Score: ${meter?.Score ?? "?"}, Drivers: ${onShift.length} on-shift${paused.length ? `, ${paused.length} paused` : ""}) ──`);

    // Drivers in this zone
    if (zoneDrivers.length > 0) {
      lines.push(`  Drivers:`);
      for (const d of zoneDrivers) {
        const status = d.Paused ? "PAUSED" : d.OnShift ? "ON-SHIFT" : d.Available ? "ON-CALL" : "OFF";
        const orderCount = zoneOrders.filter((o: any) => o.DriverId === d.DriverId).length;
        const name = d.Monacher || d.FullName || d.DriverId;
        const training = d.TrainingOrders > 0 ? ` [TRAINEE: ${d.TrainingOrders} orders left]` : "";
        const alcohol = d.Alcohol ? " [Smart Serve]" : "";
        const nearEnd = d.NearEnd ? " [NEAR END]" : "";
        lines.push(`    ${name} (${status}) — ${orderCount} orders${training}${alcohol}${nearEnd}`);
      }
    }

    // Orders in this zone
    if (zoneOrders.length > 0) {
      lines.push(`  Orders:`);
      for (const o of zoneOrders) {
        const readyTime = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;
        const readyStr = formatTime(readyTime);
        const readyAgo = minutesAgo(readyTime);
        const driverName = zoneDrivers.find((d: any) => d.DriverId === o.DriverId)?.Monacher
          || zoneDrivers.find((d: any) => d.DriverId === o.DriverId)?.FullName
          || (o.DriverId ? o.DriverId.split("@")[0] : "UNASSIGNED");
        const restaurant = o.RestaurantName || "Unknown";
        const status = o.OrderStatus || "?";
        const customer = o.DeliveryStreet ? `${o.DeliveryStreet}, ${o.DeliveryCity || ""}` : "no address";
        const isLate = readyTime && readyTime.getTime() < Date.now() && !["InTransit", "Delivered"].includes(status);
        const lateFlag = isLate ? " ⚠️ LATE" : "";
        const unconfirmed = !o.DeliveryConfirmed && status === "Placed" ? " [UNCONFIRMED]" : "";
        const alcohol = o.Alcohol ? " [ALCOHOL]" : "";

        lines.push(`    ${o.OrderIdKey} | ${status}${lateFlag}${unconfirmed}${alcohol} | ${restaurant} → ${customer} | Driver: ${driverName} | Ready: ${readyStr} (${readyAgo})`);
      }
    }

    lines.push(``);
  }

  // ── Markets with no orders but critical scores ──
  const criticalEmpty = zones.filter((z) => {
    const zd = dispatchData[z];
    return (zd.Orders?.length ?? 0) === 0 && (zd.Drivers?.length ?? 0) === 0 && (zd.Meter?.Score ?? 0) >= 80;
  });
  if (criticalEmpty.length > 0) {
    lines.push(`── CRITICAL: No drivers or orders ──`);
    for (const z of criticalEmpty) {
      lines.push(`  ${z}: Score ${dispatchData[z].Meter?.Score}, needs ${dispatchData[z].Meter?.idealDrivers} drivers`);
    }
    lines.push(``);
  }

  // ── Summary stats ──
  lines.push(`── Summary ──`);
  lines.push(`  Total: ${allOrders.length} orders, ${allDrivers.length} drivers across ${zones.length} markets`);
  const unassigned = allOrders.filter((o) => !o.driverId);
  if (unassigned.length > 0) {
    lines.push(`  ⚠️ ${unassigned.length} orders have no driver assigned`);
  }

  // ── Events ──
  if (events.length > 0) {
    const dispatcher = new EventDispatcher();
    lines.push(``);
    lines.push(`── Events ──`);
    for (const e of events.slice(0, 10)) {
      lines.push(`  ${dispatcher.formatEventForAgent(e)}`);
    }
  }

  lines.push(``);
  lines.push(`Analyze each market. For orders that are LATE or have issues, describe what action you would take. Be specific — use order IDs, driver names, restaurant names.`);

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
    latestDispatchData = data;
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

      const prompt = buildSituationReport(currentStore, latestDispatchData, eventsForLlm);

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
