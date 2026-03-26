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
import { mkdirSync, appendFileSync } from "node:fs";

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

const POLL_INTERVAL_MS = 20_000;
const HEARTBEAT_INTERVAL_MS = 90_000;
const LLM_COOLDOWN_MS = 30_000;
// Model is set via LLM_MODEL in .env

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
let previousDispatchData: any = null;
let isFirstCycle = true;
const startTime = Date.now();

// Log file
const TZ = process.env.BUSINESS_TIMEZONE ?? "America/Toronto";
const logDate = new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
mkdirSync("reports", { recursive: true });
const LOG_FILE = `reports/shadow-${logDate}.md`;

function now(): string {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZone: TZ });
}

function log(text: string) {
  console.log(text);
  // Strip ANSI color codes for the file
  const clean = text.replace(/\x1b\[[0-9;]*m/g, "");
  appendFileSync(LOG_FILE, clean + "\n");
}

function logRaw(text: string) {
  appendFileSync(LOG_FILE, text + "\n");
}

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
// DynamoDB: fetch open tickets from IssueTracker
// ---------------------------------------------------------------------------

const SISYPHUS_EMAIL = process.env.DISPATCH_USERNAME ?? "sisyphus@valleyeats.ca";

async function fetchRelevantTickets(): Promise<any[]> {
  const tickets: any[] = [];

  // Query New, Pending, and Awaiting Response tickets
  for (const status of ["New", "Pending", "Awaiting Response"]) {
    try {
      const result = await dynamo.send(
        new QueryCommand({
          TableName: "ValleyEats-IssueTracker",
          IndexName: "IssueStatus-Created-index",
          KeyConditionExpression: "IssueStatus = :s",
          ExpressionAttributeValues: { ":s": { S: status } },
          Limit: 50,
          ScanIndexForward: false, // newest first
        }),
      );
      if (result.Items) {
        for (const item of result.Items) {
          try {
            const ticket = transformTicket(unmarshall(item));
            // Only keep tickets that are unassigned or assigned to us
            if (ticket.owner === "Unassigned" || ticket.owner === SISYPHUS_EMAIL) {
              tickets.push(ticket);
            }
          } catch { /* skip bad records */ }
        }
      }
    } catch (err: any) {
      log(`  \x1b[33m[${now()}] Warning: Failed to query DynamoDB tickets (${status}): ${err.message}\x1b[0m`);
    }
  }

  return tickets;
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
// Diff detection — captures SPECIFIC changes, not just counts
// ---------------------------------------------------------------------------

interface ChangeDetail {
  type: "new_order" | "order_status" | "order_completed" | "order_assigned" | "driver_online" | "driver_offline" | "driver_paused" | "driver_unpaused" | "driver_appeared" | "driver_disappeared";
  description: string;
  zone?: string;
}

interface Changes {
  details: ChangeDetail[];
  hasChanges: boolean;
  summary: string;
}

function detectChanges(
  current: OntologyStore,
  previous: OntologyStore | null,
  currentData: any,
  previousData: any,
): Changes {
  const details: ChangeDetail[] = [];

  if (!previous || !previousData) {
    return { details, hasChanges: false, summary: "Initial sync" };
  }

  const zones = Object.keys(currentData).filter((k) => k !== "Timestamp");

  for (const zone of zones) {
    const curOrders = currentData[zone]?.Orders ?? [];
    const prevOrders = previousData[zone]?.Orders ?? [];
    const curDrivers = currentData[zone]?.Drivers ?? [];
    const prevDrivers = previousData[zone]?.Drivers ?? [];

    const prevOrderMap = new Map(prevOrders.map((o: any) => [o.OrderId, o]));
    const prevDriverMap = new Map(prevDrivers.map((d: any) => [d.DriverId, d]));
    const curOrderMap = new Map(curOrders.map((o: any) => [o.OrderId, o]));
    const curDriverMap = new Map(curDrivers.map((d: any) => [d.DriverId, d]));

    // New orders
    for (const o of curOrders) {
      const prev = prevOrderMap.get(o.OrderId);
      if (!prev) {
        const driver = curDrivers.find((d: any) => d.DriverId === o.DriverId);
        const driverName = driver?.Monacher || driver?.FullName || (o.DriverId ? o.DriverId.split("@")[0] : "none");
        details.push({
          type: "new_order",
          zone,
          description: `New order ${o.OrderIdKey} from ${o.RestaurantName} (${o.OrderStatus}) — driver: ${driverName}`,
        });
      } else if (prev.OrderStatus !== o.OrderStatus) {
        details.push({
          type: "order_status",
          zone,
          description: `Order ${o.OrderIdKey} (${o.RestaurantName}): ${prev.OrderStatus} → ${o.OrderStatus}`,
        });
      }
      // Driver assignment changed
      if (prev && prev.DriverId !== o.DriverId && o.DriverId) {
        const newDriver = curDrivers.find((d: any) => d.DriverId === o.DriverId);
        const oldDriver = prevDrivers.find((d: any) => d.DriverId === prev.DriverId);
        details.push({
          type: "order_assigned",
          zone,
          description: `Order ${o.OrderIdKey} reassigned: ${oldDriver?.Monacher || "none"} → ${newDriver?.Monacher || o.DriverId.split("@")[0]}`,
        });
      }
    }

    // Orders that disappeared = delivered/completed (normal)
    for (const o of prevOrders) {
      if (!curOrderMap.has(o.OrderId)) {
        details.push({
          type: "order_completed",
          zone,
          description: `Order ${o.OrderIdKey} (${o.RestaurantName}) delivered/completed`,
        });
      }
    }

    // Driver changes
    for (const d of curDrivers) {
      const prev = prevDriverMap.get(d.DriverId);
      const name = d.Monacher || d.FullName || d.DriverId.split("@")[0];
      if (!prev) {
        details.push({
          type: "driver_appeared",
          zone,
          description: `Driver ${name} appeared in ${zone} (${d.OnShift ? "on-shift" : "off-shift"})`,
        });
      } else {
        if (!prev.OnShift && d.OnShift) {
          details.push({ type: "driver_online", zone, description: `Driver ${name} came on-shift in ${zone}` });
        } else if (prev.OnShift && !d.OnShift) {
          details.push({ type: "driver_offline", zone, description: `Driver ${name} went off-shift in ${zone}` });
        }
        if (!prev.Paused && d.Paused) {
          details.push({ type: "driver_paused", zone, description: `Driver ${name} was paused in ${zone}` });
        } else if (prev.Paused && !d.Paused) {
          details.push({ type: "driver_unpaused", zone, description: `Driver ${name} was unpaused in ${zone}` });
        }
      }
    }

    // Drivers that disappeared
    for (const d of prevDrivers) {
      if (!curDriverMap.has(d.DriverId)) {
        const name = d.Monacher || d.FullName || d.DriverId.split("@")[0];
        details.push({
          type: "driver_disappeared",
          zone,
          description: `Driver ${name} left dispatch in ${zone}`,
        });
      }
    }
  }

  const summary = details.length > 0
    ? details.map((d) => d.description).join("; ")
    : "No changes";

  return { details, hasChanges: details.length > 0, summary };
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

function buildChangesPrompt(
  changes: Changes,
  dispatchData: any,
  isFirstCycle: boolean,
): string {
  const zones = Object.keys(dispatchData).filter((k) => k !== "Timestamp");
  const lines: string[] = [];

  if (isFirstCycle) {
    // First cycle — give full board state
    lines.push(`SISYPHUS SHADOW DISPATCH — ${new Date().toLocaleString("en-US", { timeZone: "America/Toronto" })}`);
    lines.push(`This is the initial state. Review the full board and identify any issues.`);
    lines.push(``);

    for (const zone of zones) {
      const zd = dispatchData[zone];
      const orders = zd.Orders ?? [];
      const drivers = zd.Drivers ?? [];
      if (orders.length === 0 && drivers.length === 0) continue;

      const onShift = drivers.filter((d: any) => d.OnShift && !d.Paused);
      lines.push(`── ${zone} (${onShift.length} drivers on-shift, ${orders.length} orders) ──`);

      for (const d of drivers) {
        const status = d.Paused ? "PAUSED" : d.OnShift ? "ON-SHIFT" : d.Available ? "ON-CALL" : "OFF";
        const orderCount = orders.filter((o: any) => o.DriverId === d.DriverId).length;
        const name = d.Monacher || d.FullName?.split(" ")[0] || d.DriverId.split("@")[0];
        const flags = [
          d.TrainingOrders > 0 ? `trainee(${d.TrainingOrders})` : "",
          d.Alcohol ? "smartserve" : "",
          d.NearEnd ? "NEAR-END" : "",
        ].filter(Boolean).join(", ");
        lines.push(`  ${name}: ${status}, ${orderCount} orders${flags ? ` [${flags}]` : ""}`);
      }

      for (const o of orders) {
        const readyTime = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;
        const driver = drivers.find((d: any) => d.DriverId === o.DriverId);
        const driverName = driver?.Monacher || driver?.FullName?.split(" ")[0] || (o.DriverId ? o.DriverId.split("@")[0] : "UNASSIGNED");
        const isLate = readyTime && readyTime.getTime() < Date.now() && !["InTransit"].includes(o.OrderStatus);
        const alcohol = o.Alcohol ? " [ALCOHOL]" : "";
        lines.push(`  Order ${o.OrderIdKey}: ${o.OrderStatus}${isLate ? " ⚠️LATE" : ""}${alcohol} | ${o.RestaurantName} → ${o.DeliveryStreet || "?"}, ${o.DeliveryCity || ""} | Driver: ${driverName} | Ready: ${formatTime(readyTime)} (${minutesAgo(readyTime)})`);
      }
      lines.push(``);
    }

    // Markets with no drivers but active demand
    const noDriverMarkets = zones.filter((z) => {
      const zd = dispatchData[z];
      return (zd.Drivers?.length ?? 0) === 0 && (zd.Meter?.idealDrivers ?? 0) > 0;
    });
    if (noDriverMarkets.length > 0) {
      lines.push(`⚠️ NO DRIVERS: ${noDriverMarkets.join(", ")}`);
      lines.push(``);
    }
  } else if (!changes.hasChanges) {
    lines.push(`No changes since last cycle. All markets stable.`);
    return lines.join("\n");
  } else {
    // Subsequent cycles — only report what changed
    lines.push(`CHANGES DETECTED — ${new Date().toLocaleTimeString("en-US", { timeZone: "America/Toronto" })}`);
    lines.push(``);

    for (const change of changes.details) {
      const prefix = change.zone ? `[${change.zone}] ` : "";
      lines.push(`• ${prefix}${change.description}`);
    }
    lines.push(``);

    // Include current state of affected zones only
    const affectedZones = new Set(changes.details.map((d) => d.zone).filter(Boolean));
    for (const zone of affectedZones) {
      const zd = dispatchData[zone!];
      if (!zd) continue;
      const orders = zd.Orders ?? [];
      const drivers = zd.Drivers ?? [];
      const meter = zd.Meter;
      const onShift = drivers.filter((d: any) => d.OnShift && !d.Paused);

      lines.push(`Current state of ${zone} (${onShift.length} on-shift, ${orders.length} orders):`);
      for (const d of drivers) {
        const status = d.Paused ? "PAUSED" : d.OnShift ? "ON-SHIFT" : "OFF";
        const orderCount = orders.filter((o: any) => o.DriverId === d.DriverId).length;
        const name = d.Monacher || d.FullName?.split(" ")[0] || d.DriverId.split("@")[0];
        lines.push(`  ${name}: ${status}, ${orderCount} orders`);
      }
      for (const o of orders) {
        const readyTime = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;
        const driver = drivers.find((d: any) => d.DriverId === o.DriverId);
        const driverName = driver?.Monacher || driver?.FullName?.split(" ")[0] || "?";
        const isLate = readyTime && readyTime.getTime() < Date.now() && !["InTransit"].includes(o.OrderStatus);
        const alcohol = o.Alcohol ? " [ALCOHOL]" : "";
        lines.push(`  Order ${o.OrderIdKey}: ${o.OrderStatus}${isLate ? " ⚠️LATE" : ""}${alcohol} | ${o.RestaurantName} | Driver: ${driverName} | Ready: ${formatTime(readyTime)} (${minutesAgo(readyTime)})`);
      }
      lines.push(``);
    }
  }

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
    previousDispatchData = latestDispatchData;
    latestDispatchData = data;
    const { orders, drivers, markets, timestamp } = parseDispatchData(data);

    // 2. Save previous state, update current
    previousStore = currentStore;
    currentStore = new OntologyStore();
    currentStore.updateOrders(orders);
    currentStore.updateDrivers(drivers);
    currentStore.updateMarkets(markets);

    // 2b. Sync tickets from DynamoDB every 3rd cycle (~60s) or on first cycle
    if (isFirstCycle || cycleCount % 3 === 0) {
      try {
        const tickets = await fetchRelevantTickets();
        currentStore.updateTickets(tickets);
        if (tickets.length > 0) {
          log(`  [${now()}] Synced ${tickets.length} open ticket(s) from DynamoDB`);
        }
      } catch (err: any) {
        log(`  \x1b[33m[${now()}] Warning: Ticket sync failed -- continuing with 0 tickets: ${err.message}\x1b[0m`);
      }
    } else if (previousStore) {
      // Carry forward tickets from previous cycle on non-sync cycles
      currentStore.updateTickets([...previousStore.tickets.values()]);
    }

    // 3. Detect specific changes
    const changes = detectChanges(currentStore, previousStore, latestDispatchData, previousDispatchData);

    // 4. Log cycle
    const elapsed = Date.now() - cycleStart;
    const ts = new Date(timestamp * 1000).toLocaleTimeString();

    if (changes.hasChanges) {
      log(`  \x1b[33m[${now()}]\x1b[0m ${changes.details.length} changes | ${elapsed}ms`);
      for (const d of changes.details) {
        log(`    • [${now()}] ${d.description}`);
      }
    } else if (!isFirstCycle) {
      process.stdout.write(".");
    }

    // 5. Decide whether to invoke LLM
    const timeSinceLastLlm = Date.now() - lastLlmCall;
    const isHeartbeat = timeSinceLastLlm > HEARTBEAT_INTERVAL_MS && !isFirstCycle;

    const shouldInvokeLlm =
      (isFirstCycle || changes.hasChanges || isHeartbeat) &&
      timeSinceLastLlm > LLM_COOLDOWN_MS;

    if (shouldInvokeLlm) {
      totalEventsProcessed += changes.details.length;

      const reason = isFirstCycle ? "initial review" : isHeartbeat ? "heartbeat" : `${changes.details.length} changes`;
      log(`\n  \x1b[36m[${now()}] → Invoking LLM (${reason})...\x1b[0m`);

      let prompt = buildChangesPrompt(changes, latestDispatchData, isFirstCycle);

      // Append open ticket summary to the situation report
      const ticketCount = currentStore.tickets.size;
      if (ticketCount > 0) {
        const ticketLines: string[] = [`\n── Open Tickets (${ticketCount}) ──`];
        for (const t of currentStore.tickets.values()) {
          const age = Math.round((Date.now() - t.createdAt.getTime()) / 60000);
          ticketLines.push(
            `  ${t.issueId}: [${t.status}] ${t.category} / ${t.issueType} — ${t.restaurantName ?? t.originator} (${age}m old)`,
          );
        }
        prompt += "\n" + ticketLines.join("\n") + "\n";
      }

      const systemPrompt = [
        "You are Sisyphus, an AI dispatcher for ValleyEats food delivery. You are in SHADOW MODE — you observe and analyze but do NOT take actions.",
        "",
        "CRITICAL RULES:",
        "- NEVER suggest reassigning an order that is InBag or InTransit. The driver has the food. Instead: message the driver to check on them, and escalate if no response.",
        "- Alcohol/Smart Serve only matters if the ORDER has an Alcohol flag (Alcohol: true). A restaurant being a pub/bar does NOT mean the order has alcohol. The system already prevents assigning alcohol orders to non-certified drivers.",
        "- When an order LEAVES dispatch (disappears), it was DELIVERED/COMPLETED. This is normal — do not flag it as an issue.",
        "- For late InTransit orders: check the order timeline to determine if the RESTAURANT caused the delay (late ready time) vs the DRIVER (not moving). If the restaurant was late, the driver is doing their best — don't blame them.",
        "- Only suggest ReassignOrder for orders that are Placed, Confirmed, or Ready — never InBag or InTransit.",
        "- MARKET HOURS: Markets have operating hours. If a market has 0 drivers AND 0 orders, it is either closed for the night or doesn't operate on this day. Do NOT flag these as issues. Only flag a market if it SHOULD be open (has operating hours right now) but has no drivers while orders are coming in.",
        "- DRIVER GOING OFF-SHIFT: When a driver goes offline/off-shift but still has an active InTransit order, this is NORMAL. Drivers commonly finish their last delivery after their shift ends. Just monitor that they complete the delivery — don't escalate unless they stop moving for 10+ minutes.",
        "",
        "When changes occur, analyze them and describe what you WOULD do. For EACH proposed action:",
        "1. What changed and why it matters (include timestamp)",
        "2. What action you would take (AssignDriverToOrder, ReassignOrder, SendDriverMessage, FlagMarketIssue, EscalateTicket, etc.)",
        "3. Your reasoning — weigh the options. Which drivers were considered? Why pick one over another? Consider: distance, current order load, shift time remaining, trainee status.",
        "4. What alternatives you considered and why you rejected them",
        "",
        "If nothing needs attention, say 'All clear — no action needed.' and briefly explain why.",
        "Be concise but show your reasoning. A dispatcher reading this should understand WHY you chose what you chose.",
      ].join("\n");

      const response = await callLlm([
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ]);

      const content = response.choices[0]?.message?.content ?? "(no response)";
      lastLlmCall = Date.now();
      totalLlmCalls++;
      isFirstCycle = false;

      const usage = response.usage;
      const tokens = usage ? `${usage.prompt_tokens}in/${usage.completion_tokens}out` : "?";
      log(`  \x1b[32m── LLM Response #${totalLlmCalls} [${now()}] (${tokens}) ──\x1b[0m`);
      log(content.split("\n").map((l: string) => `  ${l}`).join("\n"));
      log(`  \x1b[32m──────────────────────\x1b[0m\n`);
    } else if (isFirstCycle) {
      isFirstCycle = false; // Even if we didn't call LLM, don't re-send full state
    }
  } catch (err: any) {
    log(`  \x1b[31m[${now()}] Error:\x1b[0m ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

logRaw(`# Sisyphus Shadow Watch — ${logDate}\n`);
logRaw(`Model: ${process.env.LLM_MODEL}`);
logRaw(`Started: ${now()}`);
logRaw(`Poll interval: ${POLL_INTERVAL_MS / 1000}s | Heartbeat: ${HEARTBEAT_INTERVAL_MS / 1000}s`);
logRaw(`Log file: ${LOG_FILE}\n---\n`);

log("\n\x1b[1m  Sisyphus Shadow Watcher\x1b[0m");
log(`  Model: ${process.env.LLM_MODEL}`);
log(`  Log file: ${LOG_FILE}`);
log(`  Polling every ${POLL_INTERVAL_MS / 1000}s | Heartbeat every ${HEARTBEAT_INTERVAL_MS / 1000}s`);
log(`  Press Ctrl+C to stop\n`);

// Run immediately, then on interval
await pollCycle();
const interval = setInterval(() => pollCycle(), POLL_INTERVAL_MS);

// Graceful shutdown
process.on("SIGINT", () => {
  clearInterval(interval);
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const usage = tokenTracker.getSummary();
  const summary = [
    `\n---\n## Summary`,
    `Stopped: ${now()}`,
    `Duration: ${duration} minutes`,
    `Cycles: ${cycleCount}`,
    `LLM calls: ${totalLlmCalls}`,
    `Events processed: ${totalEventsProcessed}`,
    `Tokens: ${usage.totalInput + usage.totalOutput} total`,
    `Est. cost: $${tokenTracker.estimateCost().toFixed(4)}`,
  ].join("\n");
  log(`\n\x1b[1m${summary}\x1b[0m\n`);
  logRaw(summary);
  process.exit(0);
});
