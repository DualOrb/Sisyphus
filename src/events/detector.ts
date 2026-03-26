/**
 * Event detector — scans the ontology store for actionable dispatch situations.
 *
 * The detector diffs the current state (and optionally a previous snapshot) to
 * find conditions that need agent attention: unassigned orders, hot markets,
 * new tickets, drivers going offline with active orders, and status changes.
 *
 * Returns a sorted list of PrioritizedEvents (critical first).
 */

import type { OntologyStore } from "../ontology/state/store.js";
import type { Order, Driver, Market, Ticket } from "../ontology/objects/index.js";
import type { PrioritizedEvent, EventPriority } from "./types.js";
import { PRIORITY_WEIGHT } from "./types.js";

// ---------------------------------------------------------------------------
// EventDetector
// ---------------------------------------------------------------------------

export class EventDetector {
  /**
   * Scan the ontology store and return events for every actionable condition.
   *
   * @param store          Current ontology state.
   * @param previousStore  Optional previous snapshot for diff-based detection.
   */
  detect(store: OntologyStore, previousStore?: OntologyStore): PrioritizedEvent[] {
    const events: PrioritizedEvent[] = [];
    const now = new Date();

    this.detectUnassignedOrders(store, events, now);
    this.detectMarketAlerts(store, events, now);
    this.detectNewTickets(store, events, now);
    this.detectDriversOfflineWithOrders(store, previousStore, events, now);
    this.detectOrderStatusChanges(store, previousStore, events, now);

    // Sort by priority weight (critical first), then by createdAt (oldest first)
    events.sort((a, b) => {
      const pw = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      if (pw !== 0) return pw;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return events;
  }

  // -------------------------------------------------------------------------
  // Unassigned orders pending > 3 minutes
  // -------------------------------------------------------------------------

  private detectUnassignedOrders(
    store: OntologyStore,
    events: PrioritizedEvent[],
    now: Date,
  ): void {
    const unassigned = store.queryOrders({ status: "Pending" });

    for (const order of unassigned) {
      if (order.driverId !== null) continue; // assigned

      const minutesPending = order.waitTimeMinutes;
      if (minutesPending <= 3) continue; // not yet actionable

      events.push({
        event: {
          type: "unassigned_order",
          orderId: order.orderId,
          orderIdKey: order.orderIdKey,
          restaurantName: order.restaurantName,
          deliveryZone: order.deliveryZone,
          minutesPending,
        },
        priority: "high",
        createdAt: now,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Market alerts based on score thresholds
  // -------------------------------------------------------------------------

  private detectMarketAlerts(
    store: OntologyStore,
    events: PrioritizedEvent[],
    now: Date,
  ): void {
    for (const market of store.markets.values()) {
      // Skip markets that are not operating or currently closed.
      // Markets with no drivers AND no orders AND score=100 are typically
      // either not-operating (hours set to -1) or closed for the night.
      // Only flag markets that SHOULD have drivers but don't.
      if (market.availableDrivers === 0 && market.activeOrders === 0) {
        // No drivers, no orders — this market is either closed or not operating.
        // Don't flag it. It's not an emergency if nobody is ordering.
        continue;
      }

      // Only flag if there are active orders with insufficient drivers
      if (market.availableDrivers === 0 && market.activeOrders > 0) {
        events.push({
          event: this.buildMarketAlertEvent(market, "critical"),
          priority: "high",
          createdAt: now,
        });
      } else if (market.score > 60 && market.availableDrivers > 0) {
        events.push({
          event: this.buildMarketAlertEvent(market, "warning"),
          priority: "normal",
          createdAt: now,
        });
      }
    }
  }

  private buildMarketAlertEvent(
    market: Market,
    alertLevel: string,
  ) {
    return {
      type: "market_alert" as const,
      market: market.market,
      score: market.score,
      idealDrivers: market.idealDrivers,
      availableDrivers: market.availableDrivers,
      alertLevel,
    };
  }

  // -------------------------------------------------------------------------
  // New tickets (status === "New")
  // -------------------------------------------------------------------------

  private detectNewTickets(
    store: OntologyStore,
    events: PrioritizedEvent[],
    now: Date,
  ): void {
    const newTickets = store.queryTickets({ status: "New" });

    for (const ticket of newTickets) {
      events.push({
        event: {
          type: "ticket_update",
          ticketId: ticket.issueId,
          status: ticket.status,
          category: ticket.category,
          market: ticket.market ?? "Unknown",
        },
        priority: "normal",
        createdAt: now,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Drivers that went offline but have active orders
  // -------------------------------------------------------------------------

  private detectDriversOfflineWithOrders(
    store: OntologyStore,
    previousStore: OntologyStore | undefined,
    events: PrioritizedEvent[],
    now: Date,
  ): void {
    // If no previous store, check current state for offline drivers with orders
    if (!previousStore) {
      for (const driver of store.drivers.values()) {
        if (!driver.isOnline && driver.activeOrdersCount > 0) {
          events.push({
            event: {
              type: "driver_offline",
              driverId: driver.driverId,
              driverName: driver.name,
              activeOrders: driver.activeOrdersCount,
            },
            priority: "normal",
            createdAt: now,
          });
        }
      }
      return;
    }

    // With a previous store, detect transitions from online to offline
    for (const driver of store.drivers.values()) {
      if (driver.isOnline) continue; // currently online, no issue
      if (driver.activeOrdersCount === 0) continue; // offline but no active orders

      const prev = previousStore.getDriver(driver.driverId);
      if (!prev) continue; // new driver, not a transition
      if (!prev.isOnline) continue; // was already offline, not a new event

      events.push({
        event: {
          type: "driver_offline",
          driverId: driver.driverId,
          driverName: driver.name,
          activeOrders: driver.activeOrdersCount,
        },
        priority: "normal",
        createdAt: now,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Order status changes (diff-based)
  // -------------------------------------------------------------------------

  private detectOrderStatusChanges(
    store: OntologyStore,
    previousStore: OntologyStore | undefined,
    events: PrioritizedEvent[],
    now: Date,
  ): void {
    if (!previousStore) return; // no diff possible

    for (const order of store.orders.values()) {
      const prev = previousStore.getOrder(order.orderId);
      if (!prev) continue; // new order, not a status change
      if (prev.status === order.status) continue; // no change

      events.push({
        event: {
          type: "order_status_change",
          orderId: order.orderId,
          oldStatus: prev.status,
          newStatus: order.status,
        },
        priority: "low",
        createdAt: now,
      });
    }
  }
}
