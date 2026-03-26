/**
 * Shadow Live Watcher — full infrastructure pipeline.
 *
 * Unlike shadow-watch.ts which makes raw LLM calls, this script wires
 * the REAL Sisyphus pipeline end-to-end:
 *
 *   OntologyStore -> EventDetector -> EventQueue -> EventDispatcher
 *   -> LangGraph agents (with ontology tools) -> executeAction (guardrails)
 *   -> ShadowExecutor (proposals) -> Redis cooldowns -> PostgreSQL audit
 *
 * Fetches dispatch.txt from S3 every 20s, diffs state, and feeds changes
 * through the full agent graph. Since OPERATING_MODE=shadow, all actions
 * route through the ShadowExecutor — no real side effects.
 *
 * Run:  npx tsx scripts/shadow-live.ts
 * Stop: Ctrl+C
 */

import "dotenv/config";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { mkdirSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// Infrastructure imports
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
import { AgentState, type AgentStateType } from "../src/agents/state.js";
import { createChatModel } from "../src/agents/llm-factory.js";
import {
  createSupervisorNode,
  AGENT_NAMES,
} from "../src/agents/supervisor/agent.js";
import {
  createMarketMonitorNode,
  filterMarketMonitorTools,
  MARKET_MONITOR_NAME,
} from "../src/agents/market-monitor/agent.js";
import {
  createDriverCommsNode,
  filterDriverCommsTools,
  DRIVER_COMMS_NAME,
} from "../src/agents/driver-comms/agent.js";
import {
  createCustomerSupportNode,
  filterCustomerSupportTools,
  CUSTOMER_SUPPORT_NAME,
} from "../src/agents/customer-support/agent.js";
import {
  createTaskExecutorNode,
  filterTaskExecutorTools,
  TASK_EXECUTOR_NAME,
} from "../src/agents/task-executor/agent.js";
import { createOntologyTools } from "../src/tools/ontology-tools.js";
import {
  loadProcessDirectory,
  buildSystemPrompt,
} from "../src/tools/process-loader.js";
import { executeAction } from "../src/guardrails/executor.js";
import type { ExecutionContext, AuditRecord } from "../src/guardrails/types.js";
import { registerAllActions } from "../src/ontology/actions/index.js";
import { createRedisClient } from "../src/memory/redis/client.js";
import { createPostgresClient, type PostgresDb } from "../src/memory/postgres/client.js";
import { writeAuditRecord } from "../src/memory/postgres/queries.js";
import { ShadowExecutor } from "../src/execution/shadow/executor.js";
import { ShadowMetrics } from "../src/execution/shadow/metrics.js";
import { isShadowMode } from "../src/config/mode.js";
import { createChildLogger } from "../src/lib/logger.js";
import type { PrioritizedEvent } from "../src/events/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REGION = process.env.AWS_REGION ?? "us-east-1";
const POLL_INTERVAL_MS = 20_000;
const HEARTBEAT_INTERVAL_MS = 90_000;
const LLM_COOLDOWN_MS = 30_000;
const PROCESS_DIR = resolve("processes");
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379/0";
const POSTGRES_URL =
  process.env.POSTGRES_URL ??
  "postgresql://sisyphus:sisyphus@localhost:5432/sisyphus";

const log = createChildLogger("shadow-live");

// ---------------------------------------------------------------------------
// Log file setup
// ---------------------------------------------------------------------------

const TZ = process.env.BUSINESS_TIMEZONE ?? "America/Toronto";
const logDate = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
mkdirSync("reports", { recursive: true });
const LOG_FILE = `reports/shadow-live-${logDate}.md`;

function now(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}

function logConsole(text: string) {
  console.log(text);
  const clean = text.replace(/\x1b\[[0-9;]*m/g, "");
  appendFileSync(LOG_FILE, clean + "\n");
}

function logRaw(text: string) {
  appendFileSync(LOG_FILE, text + "\n");
}

// ---------------------------------------------------------------------------
// S3 client
// ---------------------------------------------------------------------------

const s3 = new S3Client({ region: REGION });
const dynamo = new DynamoDBClient({ region: REGION });

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

  // Query New, Pending, and Awaiting Response — same as dispatch page
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
            // Only keep tickets that are unassigned or assigned to Sisyphus
            if (ticket.owner === "Unassigned" || ticket.owner === SISYPHUS_EMAIL) {
              tickets.push(ticket);
            }
          } catch { /* skip bad records */ }
        }
      }
    } catch (err: any) {
      log.warn({ err: err.message, status }, "Failed to query DynamoDB tickets");
    }
  }

  return tickets;
}

// ---------------------------------------------------------------------------
// Dispatch data parser (copied from shadow-watch.ts)
// ---------------------------------------------------------------------------

const EXCLUDED_RESTAURANTS = new Set([
  "ab8a647e-4c41-4afb-9a93-9da5fdffe93d",
  "70b13a1d-24b1-4114-8662-6854bfa38591",
]);

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

    if (zoneData.Drivers) {
      for (const d of zoneData.Drivers) {
        try {
          drivers.push(
            transformDriver({
              ...d,
              DispatchZone: d.DispatchZone ?? zone,
              DeliveryArea: d.DeliveryArea ?? zone,
              Active: d.Active ?? true,
            }),
          );
        } catch {
          /* skip bad records */
        }
      }
    }

    if (zoneData.Orders) {
      for (const o of zoneData.Orders) {
        if (EXCLUDED_RESTAURANTS.has(o.RestaurantId)) continue;
        try {
          orders.push(
            transformOrder({
              ...o,
              DeliveryZone: o.DeliveryZone ?? zone,
            }),
          );
        } catch {
          /* skip bad records */
        }
      }
    }

    if (zoneData.Meter) {
      try {
        markets.push(
          transformMarket({
            Market: zone,
            ...zoneData.Meter,
          }),
        );
      } catch {
        /* skip */
      }
    }
  }

  return { orders, drivers, markets, timestamp: data.Timestamp };
}

// ---------------------------------------------------------------------------
// Change detection (copied from shadow-watch.ts)
// ---------------------------------------------------------------------------

interface ChangeDetail {
  type:
    | "new_order"
    | "order_status"
    | "order_completed"
    | "order_assigned"
    | "driver_online"
    | "driver_offline"
    | "driver_paused"
    | "driver_unpaused"
    | "driver_appeared"
    | "driver_disappeared";
  description: string;
  zone?: string;
}

interface Changes {
  details: ChangeDetail[];
  hasChanges: boolean;
  summary: string;
}

function detectChanges(
  _current: OntologyStore,
  _previous: OntologyStore | null,
  currentData: any,
  previousData: any,
): Changes {
  const details: ChangeDetail[] = [];

  if (!_previous || !previousData) {
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

    for (const o of curOrders) {
      const prev = prevOrderMap.get(o.OrderId);
      if (!prev) {
        const driver = curDrivers.find((d: any) => d.DriverId === o.DriverId);
        const driverName =
          driver?.Monacher ||
          driver?.FullName ||
          (o.DriverId ? o.DriverId.split("@")[0] : "none");
        details.push({
          type: "new_order",
          zone,
          description: `New order ${o.OrderIdKey} from ${o.RestaurantName} (${o.OrderStatus}) -- driver: ${driverName}`,
        });
      } else if (prev.OrderStatus !== o.OrderStatus) {
        details.push({
          type: "order_status",
          zone,
          description: `Order ${o.OrderIdKey} (${o.RestaurantName}): ${prev.OrderStatus} -> ${o.OrderStatus}`,
        });
      }
      if (prev && prev.DriverId !== o.DriverId && o.DriverId) {
        const newDriver = curDrivers.find((d: any) => d.DriverId === o.DriverId);
        const oldDriver = prevDrivers.find((d: any) => d.DriverId === prev.DriverId);
        details.push({
          type: "order_assigned",
          zone,
          description: `Order ${o.OrderIdKey} reassigned: ${oldDriver?.Monacher || "none"} -> ${newDriver?.Monacher || o.DriverId.split("@")[0]}`,
        });
      }
    }

    for (const o of prevOrders) {
      if (!curOrderMap.has(o.OrderId)) {
        details.push({
          type: "order_completed",
          zone,
          description: `Order ${o.OrderIdKey} (${o.RestaurantName}) delivered/completed`,
        });
      }
    }

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

  const summary =
    details.length > 0
      ? details.map((d) => d.description).join("; ")
      : "No changes";

  return { details, hasChanges: details.length > 0, summary };
}

// ---------------------------------------------------------------------------
// Build a situation prompt for the LangGraph graph
// ---------------------------------------------------------------------------

function formatTime(date: Date | null | undefined): string {
  if (!date || isNaN(date.getTime())) return "n/a";
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Toronto",
  });
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
  firstCycle: boolean,
): string {
  const zones = Object.keys(dispatchData).filter((k) => k !== "Timestamp");
  const lines: string[] = [];

  if (firstCycle) {
    lines.push(
      `SISYPHUS SHADOW DISPATCH -- ${new Date().toLocaleString("en-US", { timeZone: "America/Toronto" })}`,
    );
    lines.push(`This is the initial state. Review the full board and identify any issues.`);
    lines.push(``);

    for (const zone of zones) {
      const zd = dispatchData[zone];
      const orders = zd.Orders ?? [];
      const drivers = zd.Drivers ?? [];
      if (orders.length === 0 && drivers.length === 0) continue;

      const onShift = drivers.filter((d: any) => d.OnShift && !d.Paused);
      lines.push(`-- ${zone} (${onShift.length} drivers on-shift, ${orders.length} orders) --`);

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
        lines.push(
          `  Order ${o.OrderIdKey}: ${o.OrderStatus}${isLate ? " LATE" : ""}${alcohol} | ${o.RestaurantName} -> ${o.DeliveryStreet || "?"}, ${o.DeliveryCity || ""} | Driver: ${driverName} | Ready: ${formatTime(readyTime)} (${minutesAgo(readyTime)})`,
        );
      }
      lines.push(``);
    }

    const noDriverMarkets = zones.filter((z) => {
      const zd = dispatchData[z];
      return (zd.Drivers?.length ?? 0) === 0 && (zd.Meter?.idealDrivers ?? 0) > 0;
    });
    if (noDriverMarkets.length > 0) {
      lines.push(`NO DRIVERS: ${noDriverMarkets.join(", ")}`);
      lines.push(``);
    }
  } else if (!changes.hasChanges) {
    lines.push(`No changes since last cycle. All markets stable.`);
    return lines.join("\n");
  } else {
    lines.push(
      `CHANGES DETECTED -- ${new Date().toLocaleTimeString("en-US", { timeZone: "America/Toronto" })}`,
    );
    lines.push(``);

    for (const change of changes.details) {
      const prefix = change.zone ? `[${change.zone}] ` : "";
      lines.push(`* ${prefix}${change.description}`);
    }
    lines.push(``);

    const affectedZones = new Set(changes.details.map((d) => d.zone).filter(Boolean));
    for (const zone of affectedZones) {
      const zd = dispatchData[zone!];
      if (!zd) continue;
      const orders = zd.Orders ?? [];
      const drivers = zd.Drivers ?? [];
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
        lines.push(
          `  Order ${o.OrderIdKey}: ${o.OrderStatus}${isLate ? " LATE" : ""}${alcohol} | ${o.RestaurantName} | Driver: ${driverName} | Ready: ${formatTime(readyTime)} (${minutesAgo(readyTime)})`,
        );
      }
      lines.push(``);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Convert raw changes into PrioritizedEvents for the event pipeline
// ---------------------------------------------------------------------------

function changesToEvents(changes: Changes): PrioritizedEvent[] {
  const events: PrioritizedEvent[] = [];
  const ts = new Date();

  for (const detail of changes.details) {
    switch (detail.type) {
      case "new_order":
        events.push({
          event: {
            type: "unassigned_order",
            orderId: "unknown",
            orderIdKey: detail.description.match(/order (\S+)/i)?.[1] ?? "?",
            restaurantName: detail.description.match(/from (.+?) \(/)?.[1] ?? "?",
            deliveryZone: detail.zone ?? "unknown",
            minutesPending: 0,
          },
          priority: "normal",
          createdAt: ts,
        });
        break;

      case "order_status":
      case "order_completed":
      case "order_assigned": {
        const oldStatus = detail.description.match(/: (\S+) ->/)?.[1] ?? "unknown";
        const newStatus = detail.description.match(/-> (\S+)/)?.[1] ?? "unknown";
        events.push({
          event: {
            type: "order_status_change",
            orderId: "unknown",
            oldStatus,
            newStatus,
          },
          priority: "low",
          createdAt: ts,
        });
        break;
      }

      case "driver_offline":
      case "driver_disappeared":
        events.push({
          event: {
            type: "driver_offline",
            driverId: "unknown",
            driverName: detail.description.match(/Driver (\S+)/)?.[1] ?? "?",
            activeOrders: 0,
          },
          priority: "high",
          createdAt: ts,
        });
        break;

      case "driver_online":
      case "driver_appeared":
      case "driver_paused":
      case "driver_unpaused":
        events.push({
          event: {
            type: "order_status_change",
            orderId: "info",
            oldStatus: "n/a",
            newStatus: detail.description,
          },
          priority: "low",
          createdAt: ts,
        });
        break;
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Build world-state snapshot from the ontology store (for guardrails)
// ---------------------------------------------------------------------------

function buildWorldState(store: OntologyStore): Record<string, unknown> {
  return {
    orders: Object.fromEntries(store.orders),
    drivers: Object.fromEntries(store.drivers),
    restaurants: Object.fromEntries(store.restaurants),
    customers: Object.fromEntries(store.customers),
    tickets: Object.fromEntries(store.tickets),
    markets: Object.fromEntries(store.markets),
    conversations: Object.fromEntries(store.conversations),
  };
}

// ---------------------------------------------------------------------------
// Custom execute_action tool with PostgreSQL + log file audit callback
// ---------------------------------------------------------------------------

function createCustomExecuteActionTool(
  store: OntologyStore,
  redis: import("ioredis").Redis,
  db: PostgresDb,
  sessionShiftId: string,
  agentId: string,
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "execute_action",
    description:
      "Execute a named action through the ontology guardrails pipeline. The action will be " +
      "validated against submission criteria, checked for cooldowns and rate limits, and " +
      "executed according to its autonomy tier (GREEN/YELLOW auto-execute, ORANGE staged " +
      "for review, RED requires human approval). ALWAYS provide a clear reasoning string " +
      "explaining why you chose this action — it is logged to the audit trail.\n\n" +
      "Available actions include: AssignDriverToOrder, ReassignOrder, UpdateOrderStatus, " +
      "CancelOrder, SendDriverMessage, FollowUpWithDriver, ResolveTicket, EscalateTicket, " +
      "AddTicketNote, FlagMarketIssue, and more.",
    schema: z.object({
      actionName: z.string().describe("The registered action name (e.g. 'SendDriverMessage', 'ReassignOrder')"),
      params: z.record(z.unknown()).describe("Action parameters as a JSON object (varies by action type)"),
      reasoning: z.string().describe("Your explanation of why you are taking this action. This is logged to the audit trail."),
    }),
    func: async (input) => {
      try {
        const executionContext: ExecutionContext = {
          redis,
          state: buildWorldState(store),
          correlationId: sessionShiftId,
          llmModel: process.env.LLM_MODEL ?? "unknown",
          llmTokensUsed: 0,
          onAudit: async (record: AuditRecord) => {
            // 1. Write to PostgreSQL
            try {
              await writeAuditRecord(db, {
                shiftId: sessionShiftId,
                timestamp: record.timestamp,
                agentId: record.agentId,
                actionType: record.actionType,
                entityType: guessEntityType(record.actionType),
                entityId: guessEntityId(record.params),
                params: record.params,
                reasoning: record.reasoning,
                submissionCheck: record.submissionCheck,
                outcome: record.outcome,
                beforeState: record.beforeState,
                afterState: record.afterState,
                sideEffectsFired: record.sideEffectsFired,
                executionTimeMs: record.executionTimeMs,
                llmModel: record.llmModel,
                llmTokensUsed: record.llmTokensUsed,
                correlationId: record.correlationId,
              });
            } catch (err: any) {
              log.warn({ err: err.message }, "Failed to write audit record to PostgreSQL");
            }

            // 2. Append to the log file
            logRaw(
              `#### Audit Record [${now()}]\n` +
                `- ID: ${record.id}\n` +
                `- Action: ${record.actionType}\n` +
                `- Agent: ${record.agentId}\n` +
                `- Outcome: ${record.outcome}\n` +
                `- Reasoning: ${record.reasoning}\n` +
                `- Execution time: ${record.executionTimeMs}ms\n` +
                `- Params: \`${JSON.stringify(record.params)}\`\n` +
                `- Submission check: \`${JSON.stringify(record.submissionCheck)}\`\n`,
            );

            // 3. Console output
            const outcomeColor =
              record.outcome === "executed"
                ? "\x1b[32m"
                : record.outcome === "staged"
                  ? "\x1b[33m"
                  : record.outcome === "cooldown_blocked"
                    ? "\x1b[36m"
                    : "\x1b[31m";
            logConsole(
              `    ${outcomeColor}AUDIT: ${record.actionType} -> ${record.outcome}\x1b[0m (${record.executionTimeMs}ms)`,
            );
          },
        };

        const result = await executeAction(
          input.actionName,
          input.params,
          input.reasoning,
          agentId,
          executionContext,
        );

        return JSON.stringify(result);
      } catch (err) {
        log.error({ err, input }, "execute_action failed");
        return JSON.stringify({
          error: "Failed to execute action",
          details: String(err),
        });
      }
    },
  });
}

function guessEntityType(actionType: string): string {
  if (actionType.includes("Order") || actionType.includes("Assign") || actionType.includes("Reassign"))
    return "order";
  if (actionType.includes("Driver") || actionType.includes("FollowUp"))
    return "driver";
  if (actionType.includes("Ticket") || actionType.includes("Escalate"))
    return "ticket";
  if (actionType.includes("Market")) return "market";
  return "unknown";
}

function guessEntityId(params: Record<string, unknown>): string {
  return (
    (params.orderId as string) ??
    (params.order_id as string) ??
    (params.driverId as string) ??
    (params.driver_id as string) ??
    (params.ticketId as string) ??
    (params.ticket_id as string) ??
    (params.market as string) ??
    "unknown"
  );
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Single store instance shared with the LangGraph graph.
 * Updated IN-PLACE each cycle via updateOrders/updateDrivers/updateMarkets
 * (which clear and repopulate). The graph's ontology tools close over this
 * reference at creation time, so we must never replace it.
 */
const ontologyStore = new OntologyStore();

/**
 * Snapshot of the previous cycle's data for diff-based detection.
 */
let previousStore: OntologyStore | null = null;

let lastLlmCall = 0;
let totalGraphCalls = 0;
let totalEventsProcessed = 0;
let cycleCount = 0;
let latestDispatchData: any = null;
let previousDispatchData: any = null;
let isFirstCycle = true;
const startTime = Date.now();
// NOTE: thread IDs are now generated per-cycle (see graph.invoke below)
// to prevent unbounded message history accumulation across cycles.
const sessionShiftId = randomUUID();

// ---------------------------------------------------------------------------
// Graph builder (custom version that injects our onAudit into tools)
// ---------------------------------------------------------------------------

function supervisorRouter(state: AgentStateType): string {
  const next = state.nextAgent;
  if (!next || next === "__end__") return END;
  if ((AGENT_NAMES as readonly string[]).includes(next)) return next;
  log.warn({ nextAgent: next }, "Unknown routing target -- ending graph");
  return END;
}

async function buildGraphWithCustomTools(
  store: OntologyStore,
  redis: import("ioredis").Redis,
  db: PostgresDb,
) {
  // 1. Load process files
  log.info({ processDir: PROCESS_DIR }, "Loading process files");
  const processes = await loadProcessDirectory(PROCESS_DIR);
  log.info({ count: processes.length }, "Process files loaded");

  const supervisorPrompt = buildSystemPrompt("supervisor", processes);
  const marketMonitorPrompt = buildSystemPrompt("market-monitor", processes);
  const driverCommsPrompt = buildSystemPrompt("driver-comms", processes);
  const customerSupportPrompt = buildSystemPrompt("customer-support", processes);
  const taskExecutorPrompt = buildSystemPrompt("task-executor", processes);

  // 2. Create ontology tools, then replace execute_action with our custom version
  const baseTools: DynamicStructuredTool[] = createOntologyTools(store, redis, "sisyphus");

  // Remove the default execute_action tool and add our custom one
  const allTools = baseTools.filter((t) => t.name !== "execute_action");
  allTools.push(createCustomExecuteActionTool(store, redis, db, sessionShiftId, "sisyphus"));

  // 3. Create LLM instances
  const defaultModel = createChatModel();
  const supervisorModel = createChatModel("escalation_decision");

  // 4. Create agent nodes
  const supervisorNode = createSupervisorNode({
    systemPrompt: supervisorPrompt,
    ontologyTools: allTools,
    model: supervisorModel,
  });

  const marketMonitorNode = createMarketMonitorNode({
    processPrompt: marketMonitorPrompt,
    tools: filterMarketMonitorTools(allTools),
    model: defaultModel,
  });

  const driverCommsNode = createDriverCommsNode({
    processPrompt: driverCommsPrompt,
    tools: filterDriverCommsTools(allTools),
    model: defaultModel,
  });

  const customerSupportNode = createCustomerSupportNode({
    processPrompt: customerSupportPrompt,
    tools: filterCustomerSupportTools(allTools),
    model: defaultModel,
  });

  const taskExecutorNode = createTaskExecutorNode({
    processPrompt: taskExecutorPrompt,
    tools: filterTaskExecutorTools(allTools),
    model: defaultModel,
  });

  // 5. Build the graph
  const graph = new StateGraph(AgentState)
    .addNode("supervisor", supervisorNode)
    .addNode(MARKET_MONITOR_NAME, marketMonitorNode)
    .addNode(DRIVER_COMMS_NAME, driverCommsNode)
    .addNode(CUSTOMER_SUPPORT_NAME, customerSupportNode)
    .addNode(TASK_EXECUTOR_NAME, taskExecutorNode)
    .addEdge(START, "supervisor")
    .addConditionalEdges("supervisor", supervisorRouter, [
      MARKET_MONITOR_NAME,
      DRIVER_COMMS_NAME,
      CUSTOMER_SUPPORT_NAME,
      TASK_EXECUTOR_NAME,
      END,
    ])
    .addEdge(MARKET_MONITOR_NAME, "supervisor")
    .addEdge(DRIVER_COMMS_NAME, "supervisor")
    .addEdge(CUSTOMER_SUPPORT_NAME, "supervisor")
    .addEdge(TASK_EXECUTOR_NAME, "supervisor");

  // 6. Compile
  const compiled = graph.compile({ checkpointer: new MemorySaver() });
  log.info("Dispatch graph compiled with custom audit tools");

  return compiled;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function initialize() {
  logConsole("\n\x1b[1m  Sisyphus Shadow Live Watcher\x1b[0m");
  logConsole(`  Mode: ${isShadowMode() ? "SHADOW" : process.env.OPERATING_MODE}`);
  logConsole(`  Model: ${process.env.LLM_MODEL}`);
  logConsole(`  Log file: ${LOG_FILE}`);
  logConsole(`  Polling every ${POLL_INTERVAL_MS / 1000}s | Heartbeat every ${HEARTBEAT_INTERVAL_MS / 1000}s`);
  logConsole(`  Press Ctrl+C to stop\n`);

  // 1. Connect to Redis
  logConsole(`  [${now()}] Connecting to Redis (${REDIS_URL})...`);
  const redis = createRedisClient(REDIS_URL);
  await redis.ping();
  logConsole(`  [${now()}] Redis connected`);

  // 2. Connect to PostgreSQL
  logConsole(`  [${now()}] Connecting to PostgreSQL (${POSTGRES_URL.replace(/:[^:@]*@/, ":***@")})...`);
  const db = createPostgresClient(POSTGRES_URL);
  logConsole(`  [${now()}] PostgreSQL pool created`);

  // 3. Register all actions
  logConsole(`  [${now()}] Registering ontology actions...`);
  await registerAllActions();
  logConsole(`  [${now()}] Actions registered`);

  // 4. OntologyStore is created at module level (ontologyStore)
  logConsole(`  [${now()}] OntologyStore ready (shared reference for graph tools)`);

  // 5. Create ShadowExecutor and ShadowMetrics
  const shadowMetrics = new ShadowMetrics();

  const shadowExecutor = new ShadowExecutor(async (proposal) => {
    shadowMetrics.record(proposal);
    logConsole(
      `  \x1b[35m[${now()}] SHADOW PROPOSAL: ${proposal.actionName} (tier: ${proposal.tier}, via: ${proposal.wouldExecuteVia})\x1b[0m`,
    );
    logConsole(`    Reasoning: ${proposal.reasoning ?? "n/a"}`);
    logConsole(`    Params: ${JSON.stringify(proposal.params)}`);
    logRaw(
      `### Shadow Proposal [${now()}]\n` +
        `- Action: ${proposal.actionName}\n` +
        `- Tier: ${proposal.tier}\n` +
        `- Would execute via: ${proposal.wouldExecuteVia}\n` +
        `- Reasoning: ${proposal.reasoning ?? "n/a"}\n` +
        `- Params: \`${JSON.stringify(proposal.params)}\`\n`,
    );
  });

  // 6. Create EventDetector, EventQueue, EventDispatcher
  const eventDetector = new EventDetector();
  const eventQueue = new EventQueue();
  const eventDispatcher = new EventDispatcher();
  logConsole(`  [${now()}] Event pipeline ready (Detector, Queue, Dispatcher)`);

  // 7. Build the LangGraph dispatch graph with custom tools
  logConsole(`  [${now()}] Building LangGraph dispatch graph...`);
  logConsole(`  [${now()}] Loading process files from ${PROCESS_DIR}...`);

  const graph = await buildGraphWithCustomTools(ontologyStore, redis, db);

  logConsole(`  [${now()}] LangGraph dispatch graph compiled`);

  // Write report header
  logRaw(`# Sisyphus Shadow Live Watch -- ${logDate}\n`);
  logRaw(`Model: ${process.env.LLM_MODEL}`);
  logRaw(`Mode: SHADOW (full pipeline)`);
  logRaw(`Session shift ID: ${sessionShiftId}`);
  logRaw(`Started: ${now()}`);
  logRaw(`Poll interval: ${POLL_INTERVAL_MS / 1000}s | Heartbeat: ${HEARTBEAT_INTERVAL_MS / 1000}s`);
  logRaw(`Redis: ${REDIS_URL}`);
  logRaw(`PostgreSQL: ${POSTGRES_URL.replace(/:[^:@]*@/, ":***@")}`);
  logRaw(`Log file: ${LOG_FILE}\n---\n`);

  logConsole(`\n  \x1b[32m[${now()}] Initialization complete. Starting poll loop...\x1b[0m\n`);

  return { redis, db, graph, shadowExecutor, shadowMetrics, eventDetector, eventQueue, eventDispatcher };
}

// ---------------------------------------------------------------------------
// Poll cycle
// ---------------------------------------------------------------------------

async function pollCycle(infra: Awaited<ReturnType<typeof initialize>>) {
  const { graph, eventDetector, eventQueue, eventDispatcher } = infra;

  cycleCount++;
  const cycleStart = Date.now();

  try {
    // 1. Fetch dispatch.txt
    const data = await fetchDispatchFile();
    previousDispatchData = latestDispatchData;
    latestDispatchData = data;
    const { orders, drivers, markets } = parseDispatchData(data);

    // 2. Update the shared store in-place (graph tools see this immediately)
    ontologyStore.updateOrders(orders);
    ontologyStore.updateDrivers(drivers);
    ontologyStore.updateMarkets(markets);

    // 2b. Sync tickets from DynamoDB every 3rd cycle (~60s) or on first cycle
    if (isFirstCycle || cycleCount % 3 === 0) {
      try {
        const tickets = await fetchRelevantTickets();
        ontologyStore.updateTickets(tickets);
        if (tickets.length > 0) {
          logConsole(`  [${now()}] Synced ${tickets.length} open ticket(s) from DynamoDB`);
        }
      } catch (err: any) {
        log.warn({ err: err.message }, "Ticket sync failed -- continuing with stale ticket data");
      }
    }

    // 3. Cross-reference: compute activeOrdersCount per driver
    for (const driver of ontologyStore.queryDrivers({})) {
      const driverOrders = ontologyStore.queryOrders({ driverId: driver.driverId });
      (driver as any).activeOrdersCount = driverOrders.length;
    }

    ontologyStore.markSynced();

    // 3. Detect specific changes (raw dispatch data diff)
    //    previousStore is null on cycle 1, so detectChanges returns "Initial sync".
    const changes = detectChanges(
      ontologyStore,
      previousStore,
      latestDispatchData,
      previousDispatchData,
    );

    // 4. Run EventDetector against the ontology store (structured detection)
    const ontologyEvents = eventDetector.detect(
      ontologyStore,
      previousStore ?? undefined,
    );

    // 5. Save a detached snapshot for next cycle's diff.
    //    We create a NEW store with the current data so it won't be affected
    //    when ontologyStore is updated in-place next cycle.
    previousStore = new OntologyStore();
    previousStore.updateOrders([...ontologyStore.orders.values()]);
    previousStore.updateDrivers([...ontologyStore.drivers.values()]);
    previousStore.updateMarkets([...ontologyStore.markets.values()]);
    previousStore.updateTickets([...ontologyStore.tickets.values()]);

    // 6. Convert raw changes into PrioritizedEvents and enqueue
    const changeEvents = changesToEvents(changes);
    eventQueue.enqueueAll(ontologyEvents);
    eventQueue.enqueueAll(changeEvents);

    // 7. Log cycle
    const elapsed = Date.now() - cycleStart;

    if (changes.hasChanges) {
      logConsole(`  \x1b[33m[${now()}]\x1b[0m ${changes.details.length} changes | ${elapsed}ms`);
      for (const d of changes.details) {
        logConsole(`    * [${now()}] ${d.description}`);
      }
    } else if (!isFirstCycle) {
      process.stdout.write(".");
    }

    // 8. Decide whether to invoke the graph
    const timeSinceLastLlm = Date.now() - lastLlmCall;
    const isHeartbeat = timeSinceLastLlm > HEARTBEAT_INTERVAL_MS && !isFirstCycle;

    const shouldInvokeGraph =
      (isFirstCycle || changes.hasChanges || isHeartbeat) &&
      timeSinceLastLlm > LLM_COOLDOWN_MS;

    if (shouldInvokeGraph) {
      totalEventsProcessed += changes.details.length;

      const reason = isFirstCycle
        ? "initial review"
        : isHeartbeat
          ? "heartbeat"
          : `${changes.details.length} changes`;
      logConsole(`\n  \x1b[36m[${now()}] -> Invoking LangGraph dispatch graph (${reason})...\x1b[0m`);

      // Build the situation prompt
      let situationPrompt = buildChangesPrompt(changes, latestDispatchData, isFirstCycle);

      // Append open ticket summary
      const ticketCount = ontologyStore.tickets.size;
      if (ticketCount > 0) {
        const ticketLines: string[] = [`\n-- Open Tickets (${ticketCount}) --`];
        for (const t of ontologyStore.tickets.values()) {
          const age = Math.round((Date.now() - t.createdAt.getTime()) / 60000);
          ticketLines.push(
            `  ${t.issueId}: [${t.status}] ${t.category} / ${t.issueType} -- ${t.restaurantName ?? t.originator} (${age}m old)`,
          );
        }
        situationPrompt += "\n" + ticketLines.join("\n") + "\n";
      }

      // Append event-pipeline formatted message if there are queued events
      let combinedPrompt = situationPrompt;
      if (!eventQueue.isEmpty) {
        const batch: PrioritizedEvent[] = [];
        const allEvents = eventQueue.drain();
        for (const evt of allEvents) {
          if (batch.length < 10) {
            batch.push(evt);
          } else {
            eventQueue.enqueue(evt);
          }
        }
        if (batch.length > 0) {
          const eventMessage = eventDispatcher.buildDispatchMessage(batch);
          combinedPrompt += `\n\n---\n\n${eventMessage}`;
        }
      }

      // Log the prompt to the report
      logRaw(`\n## Cycle ${cycleCount} [${now()}] -- ${reason}\n`);
      logRaw(`### Prompt sent to LangGraph\n\`\`\`\n${combinedPrompt}\n\`\`\`\n`);

      // Invoke the LangGraph graph with a fresh thread_id per cycle.
      // Each cycle's HumanMessage already contains the full current state,
      // so we don't need conversation history from prior cycles. A fresh
      // thread prevents MemorySaver from accumulating unbounded messages.
      const cycleThreadId = `shadow-live-cycle-${cycleCount}-${Date.now()}`;
      try {
        const result = await graph.invoke(
          { messages: [new HumanMessage(combinedPrompt)] },
          { configurable: { thread_id: cycleThreadId } },
        );

        lastLlmCall = Date.now();
        totalGraphCalls++;
        isFirstCycle = false;

        // Extract messages from the result
        const messages = (result as any)?.messages ?? [];
        const aiMessages = messages.filter(
          (m: any) => m._getType?.() === "ai" || m.constructor?.name === "AIMessage",
        );
        const lastAiMessage = aiMessages[aiMessages.length - 1];
        const responseContent =
          typeof lastAiMessage?.content === "string"
            ? lastAiMessage.content
            : lastAiMessage?.content
              ? JSON.stringify(lastAiMessage.content)
              : "(no AI response in final state)";

        // Collect all tool calls for logging
        const allToolCalls: any[] = [];
        for (const msg of aiMessages) {
          const calls = msg.tool_calls ?? msg.additional_kwargs?.tool_calls ?? [];
          allToolCalls.push(...calls);
        }

        // Console output
        logConsole(`  \x1b[32m-- LangGraph Response #${totalGraphCalls} [${now()}] --\x1b[0m`);
        if (allToolCalls.length > 0) {
          logConsole(`  Tool calls made: ${allToolCalls.length}`);
          for (const tc of allToolCalls) {
            const toolName = tc.name ?? tc.function?.name ?? "unknown";
            const toolArgs = tc.args ?? tc.function?.arguments ?? "{}";
            const argsStr = typeof toolArgs === "string" ? toolArgs : JSON.stringify(toolArgs);
            logConsole(`    -> ${toolName}(${argsStr.length > 120 ? argsStr.slice(0, 120) + "..." : argsStr})`);
          }
        }
        logConsole(responseContent.split("\n").map((l: string) => `  ${l}`).join("\n"));
        logConsole(`  \x1b[32m-------------------------\x1b[0m\n`);

        // Log response to report
        logRaw(`### LangGraph Response\n`);
        if (allToolCalls.length > 0) {
          logRaw(`**Tool calls (${allToolCalls.length}):**\n`);
          for (const tc of allToolCalls) {
            const toolName = tc.name ?? tc.function?.name ?? "unknown";
            const toolArgs = tc.args ?? tc.function?.arguments ?? "{}";
            const argsStr = typeof toolArgs === "string" ? toolArgs : JSON.stringify(toolArgs);
            logRaw(`- \`${toolName}\`: \`${argsStr}\``);
          }
          logRaw(``);
        }
        logRaw(`**Final response:**\n\`\`\`\n${responseContent}\n\`\`\`\n`);
      } catch (err: any) {
        lastLlmCall = Date.now();
        isFirstCycle = false;
        logConsole(`  \x1b[31m[${now()}] Graph invocation error:\x1b[0m ${err.message}`);
        logRaw(`### Error\n\`\`\`\n${err.message}\n${err.stack ?? ""}\n\`\`\`\n`);
      }
    } else if (isFirstCycle) {
      isFirstCycle = false;
    }
  } catch (err: any) {
    logConsole(`  \x1b[31m[${now()}] Error:\x1b[0m ${err.message}`);
    logRaw(`### Error [${now()}]\n\`\`\`\n${err.message}\n\`\`\`\n`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const infra = await initialize();

// Run immediately, then on interval
await pollCycle(infra);
const interval = setInterval(() => pollCycle(infra), POLL_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

process.on("SIGINT", async () => {
  clearInterval(interval);

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const metrics = infra.shadowMetrics.getSummary();
  const proposals = infra.shadowExecutor.getProposals();

  const summary = [
    `\n---\n## Summary`,
    `Stopped: ${now()}`,
    `Duration: ${duration} minutes`,
    `Cycles: ${cycleCount}`,
    `Graph invocations: ${totalGraphCalls}`,
    `Events processed: ${totalEventsProcessed}`,
    ``,
    `### Shadow Metrics`,
    `Total proposals: ${metrics.totalProposals}`,
    `By action: ${JSON.stringify(metrics.byAction)}`,
    `By tier: ${JSON.stringify(metrics.byTier)}`,
    `By validation: passed=${metrics.byValidation.passed}, failed=${metrics.byValidation.failed}`,
    `By agent: ${JSON.stringify(metrics.byAgent)}`,
    `By method: ${JSON.stringify(metrics.byMethod)}`,
  ].join("\n");

  logConsole(`\n\x1b[1m${summary}\x1b[0m\n`);
  logRaw(summary);

  if (proposals.length > 0) {
    logRaw(`\n### All Proposals\n`);
    for (const p of proposals) {
      logRaw(
        `- [${p.timestamp.toLocaleTimeString("en-US", { timeZone: TZ })}] ` +
          `${p.actionName} (tier: ${p.tier}, via: ${p.wouldExecuteVia}) ` +
          `-- ${p.reasoning ?? "no reasoning"}`,
      );
    }
  }

  // Clean up connections
  try {
    await infra.redis.quit();
  } catch {
    /* ignore */
  }

  process.exit(0);
});
