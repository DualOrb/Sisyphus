/**
 * Change detection — diff current vs previous dispatch.txt data.
 *
 * Extracted from cycle.ts to keep the cycle orchestrator lean.
 */

import type { OntologyStore } from "../ontology/state/store.js";
import { deriveOrderStatus } from "./prompt-builder.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChangeDetail {
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

export interface Changes {
  details: ChangeDetail[];
  hasChanges: boolean;
  summary: string;
}

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

export function detectChanges(
  store: OntologyStore,
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

    const prevOrderMap = new Map<string, any>(prevOrders.map((o: any) => [o.OrderId, o]));
    const prevDriverMap = new Map<string, any>(prevDrivers.map((d: any) => [d.DriverId, d]));
    const curOrderMap = new Map<string, any>(curOrders.map((o: any) => [o.OrderId, o]));
    const curDriverMap = new Map<string, any>(curDrivers.map((d: any) => [d.DriverId, d]));

    // New and changed orders — only report if the store will actually contain them
    for (const o of curOrders) {
      if ((o.OrderType ?? "Delivery") === "Takeout") continue;

      // Skip orders the store filters out (just-placed unassigned, future readyAt)
      // so we don't report changes the AI can't act on
      if (!o.DriverId) {
        const confirmedEpoch = o.OrderConfirmedNotifiedTime ?? o.DeliveryConfirmedTime ?? o.OrderPlacedTime;
        if (confirmedEpoch && Date.now() - confirmedEpoch * 1000 < 60 * 1000) continue;
      }
      const readyAt = o.OrderReadyTime ? new Date(o.OrderReadyTime * 1000) : null;
      if (readyAt && readyAt.getTime() > Date.now() + 60 * 60 * 1000) continue;

      const prev = prevOrderMap.get(o.OrderId);
      if (!prev) {
        const driver = curDrivers.find((d: any) => d.DriverId === o.DriverId);
        const driverLabel = o.DriverId
          ? `${driver?.Monacher || driver?.FullName || "unknown"} (${o.DriverId})`
          : "UNASSIGNED";
        details.push({
          type: "new_order",
          zone,
          description: `New order ${o.OrderIdKey} from ${o.RestaurantName} (${o.OrderStatus}) — ${o.DriverId ? "assigned to" : "UNASSIGNED, needs"} driver: ${driverLabel}`,
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

    // Completed / removed orders
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
        // Only flag if driver came on-shift — off-shift appearances with no orders are noise
        if (d.OnShift || d.Available) {
          details.push({
            type: "driver_appeared",
            zone,
            description: `Driver ${name} came online in ${zone}`,
          });
        }
        // Off-shift driver with assigned orders needs attention
        else {
          const driverOrders = curOrders.filter((o: any) => o.DriverId === d.DriverId);
          const needsAttention = driverOrders.filter((o: any) => {
            const status = deriveOrderStatus(o);
            const delivering = ["intransit", "inbag", "at-customer", "atcustomer"]
              .includes(status.currentStatus.toLowerCase().replace(/[-_ ]/g, ""));
            return !delivering;
          });
          if (needsAttention.length > 0) {
            details.push({
              type: "driver_appeared",
              zone,
              description: `Driver ${name} (${d.DriverId}) appeared OFF-SHIFT in ${zone} with ${needsAttention.length} unhandled order(s)`,
            });
          }
        }
      } else {
        if (!prev.OnShift && d.OnShift) {
          details.push({ type: "driver_online", zone, description: `Driver ${name} came on-shift in ${zone}` });
        } else if (prev.OnShift && !d.OnShift) {
          const driverOrders = curOrders.filter((o: any) => o.DriverId === d.DriverId);
          const needsAttention = driverOrders.filter((o: any) => {
            const status = deriveOrderStatus(o);
            const activeDelivery = ["intransit", "inbag", "at-customer", "atcustomer"]
              .includes(status.currentStatus.toLowerCase().replace(/[-_ ]/g, ""));
            return !activeDelivery;
          });
          if (needsAttention.length > 0) {
            const scheduleNote = d.ScheduleString ? ` [scheduled: ${d.ScheduleString}]` : "";
            details.push({ type: "driver_offline", zone, description: `Driver ${name} (${d.DriverId}) went off-shift in ${zone} WITH ${needsAttention.length} order(s) not yet picked up${scheduleNote}` });
          }
        }
        if (!prev.Paused && d.Paused) {
          details.push({ type: "driver_paused", zone, description: `Driver ${name} was paused in ${zone}` });
        } else if (prev.Paused && !d.Paused) {
          details.push({ type: "driver_unpaused", zone, description: `Driver ${name} was unpaused in ${zone}` });
        }
      }
    }

    // Drivers that left dispatch — only flag if they had orders not yet picked up
    for (const d of prevDrivers) {
      if (!curDriverMap.has(d.DriverId)) {
        const driverOrders = curOrders.filter((o: any) => o.DriverId === d.DriverId);
        const needsAttention = driverOrders.filter((o: any) => {
          const status = deriveOrderStatus(o);
          const activeDelivery = ["intransit", "inbag", "at-customer", "atcustomer"]
            .includes(status.currentStatus.toLowerCase().replace(/[-_ ]/g, ""));
          return !activeDelivery;
        });
        if (needsAttention.length > 0) {
          const name = d.Monacher || d.FullName || d.DriverId.split("@")[0];
          details.push({
            type: "driver_disappeared",
            zone,
            description: `Driver ${name} (${d.DriverId}) left dispatch in ${zone} WITH ${needsAttention.length} order(s) not yet picked up`,
          });
        }
      }
    }
  }

  const summary =
    details.length > 0
      ? details.map((d) => d.description).join("; ")
      : "No changes";

  return { details, hasChanges: details.length > 0, summary };
}
