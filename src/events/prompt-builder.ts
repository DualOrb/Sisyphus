/**
 * Prompt builder — assembles the dispatch board prompt for the supervisor.
 *
 * Extracted from cycle.ts to keep the cycle orchestrator lean.
 */

import type { OntologyStore } from "../ontology/state/store.js";
import type { Changes } from "./changes.js";
import type { PrioritizedEvent } from "./types.js";
import { AIMessage } from "@langchain/core/messages";

const TZ = "America/Toronto";

// ---------------------------------------------------------------------------
// Time formatting helpers
// ---------------------------------------------------------------------------

export function formatTime(date: Date | null | undefined): string {
  if (!date || isNaN(date.getTime())) return "n/a";
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}

export function minutesAgo(date: Date | null | undefined): string {
  if (!date || isNaN(date.getTime())) return "?";
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 0) return `in ${-mins}m`;
  if (mins === 0) return "now";
  return `${mins}m ago`;
}

// ---------------------------------------------------------------------------
// Order status helpers
// ---------------------------------------------------------------------------

export interface OrderStatusInfo {
  currentStatus: string;
  timeline: string;
  isLate: boolean;
  driverConfirmed: boolean;
}

export function deriveOrderStatus(o: any): OrderStatusInfo {
  const history: { status: string; timestamp: number }[] = o.StatusHistory ?? [];
  const lastEntry = history.length > 0 ? history[history.length - 1] : null;
  const currentStatus = lastEntry?.status ?? o.OrderStatus ?? "Unknown";

  const timelineParts: string[] = [];
  for (const h of history) {
    const t = new Date(h.timestamp * 1000).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ,
    });
    timelineParts.push(`${h.status} ${t}`);
  }
  if (timelineParts.length === 0) {
    if (o.OrderPlacedTime) timelineParts.push(`Placed ${formatTime(new Date(o.OrderPlacedTime * 1000))}`);
    if (o.DeliveryConfirmedTime) timelineParts.push(`Confirmed ${formatTime(new Date(o.DeliveryConfirmedTime * 1000))}`);
    if (o.EnrouteTime) timelineParts.push(`En-Route ${formatTime(new Date(o.EnrouteTime * 1000))}`);
    if (o.WaitingForOrderTime) timelineParts.push(`At-Restaurant ${formatTime(new Date(o.WaitingForOrderTime * 1000))}`);
  }
  const timeline = timelineParts.join(" → ");

  const readyTime = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;
  const activeStatuses = ["En-Route", "At-Restaurant", "In-Bag", "InTransit", "At-Customer"];
  const isDriverActive = activeStatuses.some(
    (s) => currentStatus.toLowerCase().replace(/[-_ ]/g, "") === s.toLowerCase().replace(/[-_ ]/g, ""),
  );

  const LATE_THRESHOLD_MS = 5 * 60 * 1000;
  const isLate = !!(
    readyTime &&
    (Date.now() - readyTime.getTime()) > LATE_THRESHOLD_MS &&
    !isDriverActive &&
    currentStatus !== "InTransit" &&
    currentStatus !== "Completed" &&
    currentStatus !== "Cancelled"
  );

  const driverConfirmed = !!(o.DeliveryConfirmed || o.DeliveryConfirmedTime);

  return { currentStatus, timeline, isLate, driverConfirmed };
}

/** Minimum time after confirmation before showing unassigned orders to the AI. */
const CONFIRMED_GRACE_PERIOD_MS = 2 * 60 * 1000;

function isRecentlyConfirmed(o: any): boolean {
  const confirmedEpoch =
    o.OrderConfirmedNotifiedTime ?? o.DeliveryConfirmedTime ?? o.OrderPlacedTime;
  if (!confirmedEpoch) return false;
  const confirmedAt = new Date(confirmedEpoch * 1000);
  return Date.now() - confirmedAt.getTime() < CONFIRMED_GRACE_PERIOD_MS;
}

// ---------------------------------------------------------------------------
// Dispatch board prompt builder
// ---------------------------------------------------------------------------

export function buildChangesPrompt(
  changes: Changes,
  dispatchData: any,
  firstCycle: boolean,
  store: OntologyStore,
): string {
  const zones = Object.keys(dispatchData).filter((k) => k !== "Timestamp");
  const lines: string[] = [];

  // ── Header: initial baseline or changes preamble ──
  if (firstCycle) {
    lines.push(
      `SISYPHUS DISPATCH -- ${new Date().toLocaleString("en-US", { timeZone: TZ })}`,
    );
    lines.push(`This is the initial state board — a BASELINE, not a list of problems.`);
    lines.push(`Most drivers and orders are operating normally. ONLY flag items that actually need intervention:`);
    lines.push(`- Orders that are LATE (5+ minutes past ready time with no driver progress)`);
    lines.push(`- Orders that are UNASSIGNED and need a driver`);
    lines.push(`- Drivers that are OFFLINE with active non-delivered orders`);
    lines.push(`- Open tickets that need resolution`);
    lines.push(`Do NOT message drivers who are actively working (En-Route, At-Restaurant, In-Bag, InTransit).`);
    lines.push(`Do NOT "check on" every driver — only those with actual problems.`);
    lines.push(``);
  } else if (changes.hasChanges) {
    lines.push(
      `CHANGES DETECTED -- ${new Date().toLocaleTimeString("en-US", { timeZone: TZ })}`,
    );
    lines.push(``);
    for (const change of changes.details) {
      const prefix = change.zone ? `[${change.zone}] ` : "";
      lines.push(`* ${prefix}${change.description}`);
    }
    lines.push(``);
    lines.push(`Full dispatch board follows.`);
    lines.push(``);
  } else {
    lines.push(
      `HEARTBEAT -- ${new Date().toLocaleTimeString("en-US", { timeZone: TZ })}`,
    );
    lines.push(`No changes since last cycle. Review the full board for anything that may need attention.`);
    lines.push(``);
  }

  // ── Full dispatch board (rendered every cycle) ──
  for (const zone of zones) {
    const zd = dispatchData[zone];
    const orders = zd.Orders ?? [];
    const drivers = zd.Drivers ?? [];
    if (orders.length === 0 && drivers.length === 0) continue;

    const onShift = drivers.filter((d: any) => d.OnShift && !d.Paused);
    lines.push(`-- ${zone} (${onShift.length} drivers on-shift, ${orders.length} orders) --`);

    for (const d of drivers) {
      if (!d.OnShift && !d.Available) {
        const driverOrders = orders.filter((o: any) => o.DriverId === d.DriverId);
        const allHandled = driverOrders.every((o: any) => {
          const ready = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;
          if (ready && (ready.getTime() - Date.now()) / 60000 > 30) return true;
          const status = deriveOrderStatus(o);
          const delivering = ["intransit", "inbag", "at-customer", "atcustomer"]
            .includes(status.currentStatus.toLowerCase().replace(/[-_ ]/g, ""));
          return delivering;
        });
        if (driverOrders.length === 0 || allHandled) continue;
      }

      const status = d.Paused ? "PAUSED" : d.OnShift ? "ON-SHIFT" : d.Available ? "ON-CALL" : "OFF";
      const visibleOrders = orders.filter((o: any) => {
        if (o.DriverId !== d.DriverId) return false;
        const ready = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;
        const minsOut = ready ? (ready.getTime() - Date.now()) / 60000 : 0;
        return !(minsOut > 30 && !d.OnShift);
      });
      const name = d.Monacher || d.FullName?.split(" ")[0] || d.DriverId.split("@")[0];
      const flags = [
        d.TrainingOrders > 0 ? `trainee(${d.TrainingOrders})` : "",
        d.Alcohol ? "smartserve" : "",
        d.NearEnd ? "NEAR-END" : "",
      ].filter(Boolean).join(", ");
      const orderIds = visibleOrders.map((o: any) => o.OrderIdKey).filter(Boolean);
      const orderIdsSuffix = orderIds.length > 0 ? ` [${orderIds.join(", ")}]` : "";
      const scheduleSuffix = !d.OnShift && !d.Available && d.ScheduleString ? ` (scheduled: ${d.ScheduleString})` : "";
      lines.push(`  ${name} (${d.DriverId}): ${status}, ${visibleOrders.length} orders${orderIdsSuffix}${flags ? ` [${flags}]` : ""}${scheduleSuffix}`);
    }

    const deliveryOrders = orders.filter((o: any) =>
      (o.OrderType ?? "Delivery") !== "Takeout"
    );

    for (const o of deliveryOrders) {
      const readyTime = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;
      const driver = drivers.find((d: any) => d.DriverId === o.DriverId);

      const minsUntilReady = readyTime ? (readyTime.getTime() - Date.now()) / 60000 : 0;
      const driverIsOffline = driver && !driver.OnShift;
      if (minsUntilReady > 30 && driverIsOffline) continue;

      const status = deriveOrderStatus(o);
      const isUnassigned = !o.DriverId;
      const hasOfflineDriver = !!driverIsOffline;

      if (isUnassigned && isRecentlyConfirmed(o)) continue;
      if (!status.isLate && !isUnassigned && !hasOfflineDriver) continue;

      const driverMonacher = driver?.Monacher || driver?.FullName?.split(" ")[0] || null;
      const driverEmail = o.DriverId || null;
      const driverLabel = driverMonacher && driverEmail
        ? `${driverMonacher} (${driverEmail})`
        : driverMonacher || driverEmail || "UNASSIGNED";
      const alcohol = o.Alcohol ? " [ALCOHOL]" : "";
      lines.push(
        `  Order ${o.OrderIdKey}: ${status.currentStatus}${status.isLate ? " LATE" : ""}${isUnassigned ? " UNASSIGNED" : ""}${alcohol} | ${o.RestaurantName} -> ${o.DeliveryStreet || "?"}, ${o.DeliveryCity || ""} | Driver: ${driverLabel} | Ready: ${formatTime(readyTime)} (${minutesAgo(readyTime)})${status.timeline ? ` | ${status.timeline}` : ""}`,
      );
    }
    lines.push(``);
  }

  // ── Unread driver messages (today only, on-dispatch drivers only) ──
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const unreadConvos = [...store.conversations.values()].filter((c) => {
    if (!c.hasUnread) return false;
    if (!store.drivers.has(c.driverId)) return false;
    // Only show messages from today's shift
    if (c.lastMessageAt < todayStart) return false;
    return true;
  });
  if (unreadConvos.length > 0) {
    lines.push(`-- UNREAD DRIVER MESSAGES (${unreadConvos.length}) --`);
    for (const c of unreadConvos) {
      const driver = store.drivers.get(c.driverId);
      const name = driver?.monacher || driver?.name || c.driverId.split("@")[0];
      const ago = Math.round((Date.now() - c.lastMessageAt.getTime()) / 60000);
      lines.push(`  ${name} (${c.driverId}): "${c.lastMessagePreview}" — ${ago}min ago`);
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

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Focus areas
// ---------------------------------------------------------------------------

export function buildFocusAreas(store: OntologyStore): string {
  const activeOrders = store.orders.size;
  const openTickets = store.tickets.size;
  const allDrivers = [...store.drivers.values()];
  const driversOnShift = allDrivers.filter((d) => d.isOnline && !d.isPaused).length;
  const activeMarkets = [...store.markets.values()].filter(
    (m) => allDrivers.some((d) => d.dispatchZone === m.market && d.isOnline),
  ).length;

  const lines = [
    `\n-- CURRENT STATS --`,
    `Active delivery orders: ${activeOrders}`,
    `Open unresolved tickets: ${openTickets}`,
    `Drivers on shift: ${driversOnShift}`,
    `Active markets: ${activeMarkets}`,
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Extract cycle summary from graph response
// ---------------------------------------------------------------------------

export function extractCycleSummary(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const isAi =
      msg instanceof AIMessage ||
      msg._getType?.() === "ai" ||
      msg.constructor?.name === "AIMessage";
    if (!isAi) continue;

    const raw =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c: any) => (typeof c === "string" ? c : c.text ?? "")).join(" ")
          : "";
    if (!raw) continue;

    const firstParagraph = raw.split(/\n\s*\n/)[0]?.trim() ?? raw.trim();
    return firstParagraph.slice(0, 500);
  }
  return "";
}

// ---------------------------------------------------------------------------
// Convert raw changes into PrioritizedEvents
// ---------------------------------------------------------------------------

export function changesToEvents(changes: Changes): PrioritizedEvent[] {
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
