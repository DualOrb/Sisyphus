/**
 * Unit tests for the Sisyphus event processing pipeline:
 * - EventDetector (unassigned orders, market alerts, driver offline, empty state)
 * - EventQueue (priority ordering, eviction when full)
 * - EventDispatcher (formatting, grouping)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { OntologyStore } from "@ontology/state/store";
import { EventDetector } from "@/events/detector";
import { EventQueue } from "@/events/queue";
import { EventDispatcher } from "@/events/dispatcher";
import type { PrioritizedEvent, EventPriority } from "@/events/types";
import type { Order, Driver, Market, Ticket } from "@ontology/objects/index";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    orderId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    orderIdKey: "a1b2c3d4",
    status: "Pending",
    orderType: "Delivery",
    deliveryType: "Hand delivered",
    isAsap: true,
    customerId: "customer@test.com",
    driverId: null,
    restaurantId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    restaurantName: "Pizza Palace",
    deliveryZone: "Perth",
    subtotal: 2500 as any,
    tax: 325 as any,
    deliveryFee: 500 as any,
    tip: 200 as any,
    total: 3525 as any,
    hasAlcohol: false,
    items: [],
    createdAt: new Date(),
    placedAt: new Date(Date.now() - 10 * 60_000), // 10 min ago
    confirmedAt: null,
    driverAssignedAt: null,
    readyAt: null,
    inBagAt: null,
    enrouteAt: null,
    inTransitAt: null,
    atCustomerAt: null,
    deliveredAt: null,
    isLate: false,
    waitTimeMinutes: 10,
    timeSinceReady: null,
    ...overrides,
  } as Order;
}

function buildDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    driverId: "driver@test.com",
    name: "Jane Smith",
    phone: "555-0100",
    agentId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
    dispatchZone: "Perth",
    deliveryArea: "Perth",
    ignoreArea: false,
    isAvailable: true,
    isPaused: false,
    isActive: true,
    connectionId: "conn-abc123",
    appVersion: "4.2.1",
    phoneModel: "iPhone 15",
    trainingOrders: 12,
    status: "Online",
    isOnline: true,
    activeOrdersCount: 0,
    ...overrides,
  } as Driver;
}

function buildMarket(overrides: Partial<Market> = {}): Market {
  return {
    market: "Perth",
    score: 45,
    idealDrivers: 5,
    availableDrivers: 4,
    lastUpdated: new Date(),
    eta: 25,
    driverGap: 1,
    demandLevel: "Normal",
    activeOrders: 5,
    driverToOrderRatio: 0.8,
    ...overrides,
  } as Market;
}

function buildTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    issueId: "abc12345",
    category: "Order Issue",
    issueType: "Other",
    status: "New",
    createdAt: new Date(),
    orderId: null,
    orderIdKey: null,
    restaurantId: null,
    restaurantName: null,
    driverId: null,
    market: "Perth",
    originator: "customer@test.com",
    owner: "Unassigned",
    description: "My order is late",
    resolution: null,
    actions: [],
    messages: [],
    notes: [],
    ...overrides,
  } as Ticket;
}

function makePrioritizedEvent(
  priority: EventPriority,
  overrides: Partial<PrioritizedEvent> = {},
): PrioritizedEvent {
  return {
    event: {
      type: "unassigned_order",
      orderId: "ord-1",
      orderIdKey: "ord1",
      restaurantName: "Test Restaurant",
      deliveryZone: "Perth",
      minutesPending: 5,
    },
    priority,
    createdAt: new Date(),
    ...overrides,
  };
}

// ===========================================================================
// EVENT DETECTOR
// ===========================================================================

describe("EventDetector", () => {
  let detector: EventDetector;
  let store: OntologyStore;

  beforeEach(() => {
    detector = new EventDetector();
    store = new OntologyStore();
  });

  // -------------------------------------------------------------------------
  // Unassigned orders
  // -------------------------------------------------------------------------

  describe("unassigned orders", () => {
    it("detects unassigned orders pending > 3 minutes", () => {
      const order = buildOrder({
        orderId: "order-123",
        orderIdKey: "order123",
        driverId: null,
        status: "Pending",
        waitTimeMinutes: 5,
        restaurantName: "Pizza Palace",
        deliveryZone: "Perth",
      });
      store.updateOrders([order]);

      const events = detector.detect(store);

      const unassigned = events.filter((e) => e.event.type === "unassigned_order");
      expect(unassigned).toHaveLength(1);
      expect(unassigned[0].priority).toBe("high");

      const evt = unassigned[0].event;
      if (evt.type === "unassigned_order") {
        expect(evt.orderId).toBe("order-123");
        expect(evt.minutesPending).toBe(5);
        expect(evt.restaurantName).toBe("Pizza Palace");
        expect(evt.deliveryZone).toBe("Perth");
      }
    });

    it("ignores unassigned orders pending <= 3 minutes", () => {
      const order = buildOrder({
        driverId: null,
        status: "Pending",
        waitTimeMinutes: 2,
      });
      store.updateOrders([order]);

      const events = detector.detect(store);
      const unassigned = events.filter((e) => e.event.type === "unassigned_order");
      expect(unassigned).toHaveLength(0);
    });

    it("ignores orders that already have a driver assigned", () => {
      const order = buildOrder({
        driverId: "driver@test.com",
        status: "Pending",
        waitTimeMinutes: 10,
      });
      store.updateOrders([order]);

      const events = detector.detect(store);
      const unassigned = events.filter((e) => e.event.type === "unassigned_order");
      expect(unassigned).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Market alerts
  // -------------------------------------------------------------------------

  describe("market alerts", () => {
    it("detects markets with score > 80 as high priority", () => {
      const market = buildMarket({
        market: "Perth",
        score: 85,
        idealDrivers: 8,
        availableDrivers: 2,
      });
      store.updateMarkets([market]);

      const events = detector.detect(store);
      const alerts = events.filter((e) => e.event.type === "market_alert");
      expect(alerts).toHaveLength(1);
      expect(alerts[0].priority).toBe("high");

      const evt = alerts[0].event;
      if (evt.type === "market_alert") {
        expect(evt.market).toBe("Perth");
        expect(evt.score).toBe(85);
        expect(evt.alertLevel).toBe("critical");
      }
    });

    it("detects markets with score > 60 as normal priority", () => {
      const market = buildMarket({
        market: "Petawawa",
        score: 72,
        idealDrivers: 5,
        availableDrivers: 2,
      });
      store.updateMarkets([market]);

      const events = detector.detect(store);
      const alerts = events.filter((e) => e.event.type === "market_alert");
      expect(alerts).toHaveLength(1);
      expect(alerts[0].priority).toBe("normal");

      const evt = alerts[0].event;
      if (evt.type === "market_alert") {
        expect(evt.alertLevel).toBe("warning");
      }
    });

    it("does not alert for markets with score <= 60", () => {
      const market = buildMarket({ score: 50 });
      store.updateMarkets([market]);

      const events = detector.detect(store);
      const alerts = events.filter((e) => e.event.type === "market_alert");
      expect(alerts).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Driver offline with active orders
  // -------------------------------------------------------------------------

  describe("driver offline with active orders", () => {
    it("detects offline driver with active orders (no previous store)", () => {
      const driver = buildDriver({
        driverId: "bob@test.com",
        name: "Bob Jones",
        isOnline: false,
        isAvailable: false,
        connectionId: null,
        status: "Offline",
        activeOrdersCount: 2,
      });
      store.updateDrivers([driver]);

      const events = detector.detect(store);
      const offline = events.filter((e) => e.event.type === "driver_offline");
      expect(offline).toHaveLength(1);
      expect(offline[0].priority).toBe("critical");

      const evt = offline[0].event;
      if (evt.type === "driver_offline") {
        expect(evt.driverId).toBe("bob@test.com");
        expect(evt.driverName).toBe("Bob Jones");
        expect(evt.activeOrders).toBe(2);
      }
    });

    it("detects driver transitioning from online to offline (with previous store)", () => {
      const previousStore = new OntologyStore();
      previousStore.updateDrivers([
        buildDriver({
          driverId: "alice@test.com",
          name: "Alice Tran",
          isOnline: true,
          activeOrdersCount: 3,
        }),
      ]);

      store.updateDrivers([
        buildDriver({
          driverId: "alice@test.com",
          name: "Alice Tran",
          isOnline: false,
          isAvailable: false,
          connectionId: null,
          status: "Offline",
          activeOrdersCount: 3,
        }),
      ]);

      const events = detector.detect(store, previousStore);
      const offline = events.filter((e) => e.event.type === "driver_offline");
      expect(offline).toHaveLength(1);
      expect(offline[0].priority).toBe("critical");
    });

    it("does not fire for driver already offline in previous store", () => {
      const previousStore = new OntologyStore();
      previousStore.updateDrivers([
        buildDriver({
          driverId: "bob@test.com",
          isOnline: false,
          activeOrdersCount: 1,
        }),
      ]);

      store.updateDrivers([
        buildDriver({
          driverId: "bob@test.com",
          isOnline: false,
          activeOrdersCount: 1,
        }),
      ]);

      const events = detector.detect(store, previousStore);
      const offline = events.filter((e) => e.event.type === "driver_offline");
      expect(offline).toHaveLength(0);
    });

    it("does not fire for offline driver with zero active orders", () => {
      store.updateDrivers([
        buildDriver({
          isOnline: false,
          activeOrdersCount: 0,
        }),
      ]);

      const events = detector.detect(store);
      const offline = events.filter((e) => e.event.type === "driver_offline");
      expect(offline).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // New tickets
  // -------------------------------------------------------------------------

  describe("new tickets", () => {
    it("detects tickets with status 'New'", () => {
      const ticket = buildTicket({
        issueId: "ticket-99",
        status: "New",
        category: "Order Issue",
        market: "Perth",
      });
      store.updateTickets([ticket]);

      const events = detector.detect(store);
      const tickets = events.filter((e) => e.event.type === "ticket_update");
      expect(tickets).toHaveLength(1);
      expect(tickets[0].priority).toBe("normal");

      const evt = tickets[0].event;
      if (evt.type === "ticket_update") {
        expect(evt.ticketId).toBe("ticket-99");
        expect(evt.status).toBe("New");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Order status changes
  // -------------------------------------------------------------------------

  describe("order status changes", () => {
    it("detects status transitions when previous store is provided", () => {
      const previousStore = new OntologyStore();
      previousStore.updateOrders([
        buildOrder({ orderId: "order-abc", status: "Pending" }),
      ]);

      store.updateOrders([
        buildOrder({
          orderId: "order-abc",
          status: "Confirmed",
          driverId: "driver@test.com",
          waitTimeMinutes: 1, // short wait to avoid unassigned detection
        }),
      ]);

      const events = detector.detect(store, previousStore);
      const changes = events.filter((e) => e.event.type === "order_status_change");
      expect(changes).toHaveLength(1);
      expect(changes[0].priority).toBe("low");

      const evt = changes[0].event;
      if (evt.type === "order_status_change") {
        expect(evt.oldStatus).toBe("Pending");
        expect(evt.newStatus).toBe("Confirmed");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Empty / clean state
  // -------------------------------------------------------------------------

  describe("empty state", () => {
    it("returns empty array when nothing is wrong", () => {
      // All good: orders assigned, markets healthy, drivers online, no new tickets
      store.updateOrders([
        buildOrder({ driverId: "driver@test.com", status: "Confirmed", waitTimeMinutes: 1 }),
      ]);
      store.updateDrivers([buildDriver({ isOnline: true, activeOrdersCount: 1 })]);
      store.updateMarkets([buildMarket({ score: 30 })]);
      store.updateTickets([buildTicket({ status: "Resolved" })]);

      const events = detector.detect(store);
      expect(events).toHaveLength(0);
    });

    it("returns empty array for a completely empty store", () => {
      const events = detector.detect(store);
      expect(events).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Priority ordering
  // -------------------------------------------------------------------------

  describe("priority ordering", () => {
    it("returns events sorted critical > high > normal > low", () => {
      // Offline driver (critical), unassigned order (high), hot market (normal)
      store.updateDrivers([
        buildDriver({
          driverId: "offline@test.com",
          name: "Offline Dan",
          isOnline: false,
          activeOrdersCount: 1,
        }),
      ]);
      store.updateOrders([
        buildOrder({
          orderId: "unassigned-ord",
          driverId: null,
          status: "Pending",
          waitTimeMinutes: 7,
        }),
      ]);
      store.updateMarkets([
        buildMarket({ market: "Perth", score: 65 }),
      ]);

      const events = detector.detect(store);
      expect(events.length).toBeGreaterThanOrEqual(3);

      // Check ordering
      expect(events[0].priority).toBe("critical"); // driver offline
      expect(events[1].priority).toBe("high"); // unassigned order
      expect(events[2].priority).toBe("normal"); // market warning
    });
  });
});

// ===========================================================================
// EVENT QUEUE
// ===========================================================================

describe("EventQueue", () => {
  let queue: EventQueue;

  beforeEach(() => {
    queue = new EventQueue();
  });

  it("starts empty", () => {
    expect(queue.isEmpty).toBe(true);
    expect(queue.size).toBe(0);
    expect(queue.dequeue()).toBeUndefined();
    expect(queue.peek()).toBeUndefined();
  });

  it("respects priority ordering: critical before high before normal before low", () => {
    queue.enqueue(makePrioritizedEvent("low"));
    queue.enqueue(makePrioritizedEvent("normal"));
    queue.enqueue(makePrioritizedEvent("critical"));
    queue.enqueue(makePrioritizedEvent("high"));

    expect(queue.size).toBe(4);

    expect(queue.dequeue()!.priority).toBe("critical");
    expect(queue.dequeue()!.priority).toBe("high");
    expect(queue.dequeue()!.priority).toBe("normal");
    expect(queue.dequeue()!.priority).toBe("low");
    expect(queue.isEmpty).toBe(true);
  });

  it("preserves FIFO within the same priority level", () => {
    const first = makePrioritizedEvent("high", {
      event: {
        type: "unassigned_order",
        orderId: "first",
        orderIdKey: "first",
        restaurantName: "R1",
        deliveryZone: "Perth",
        minutesPending: 5,
      },
    });
    const second = makePrioritizedEvent("high", {
      event: {
        type: "unassigned_order",
        orderId: "second",
        orderIdKey: "second",
        restaurantName: "R2",
        deliveryZone: "Perth",
        minutesPending: 7,
      },
    });

    queue.enqueue(first);
    queue.enqueue(second);

    const d1 = queue.dequeue()!;
    const d2 = queue.dequeue()!;

    expect(d1.event.type === "unassigned_order" && d1.event.orderId).toBe("first");
    expect(d2.event.type === "unassigned_order" && d2.event.orderId).toBe("second");
  });

  it("peek returns the highest-priority event without removing it", () => {
    queue.enqueue(makePrioritizedEvent("normal"));
    queue.enqueue(makePrioritizedEvent("critical"));

    expect(queue.peek()!.priority).toBe("critical");
    expect(queue.size).toBe(2); // not removed
  });

  it("drain returns all events in priority order and clears the queue", () => {
    queue.enqueue(makePrioritizedEvent("low"));
    queue.enqueue(makePrioritizedEvent("high"));
    queue.enqueue(makePrioritizedEvent("critical"));
    queue.enqueue(makePrioritizedEvent("normal"));

    const all = queue.drain();
    expect(all).toHaveLength(4);
    expect(all[0].priority).toBe("critical");
    expect(all[1].priority).toBe("high");
    expect(all[2].priority).toBe("normal");
    expect(all[3].priority).toBe("low");
    expect(queue.isEmpty).toBe(true);
  });

  it("enqueueAll adds multiple events", () => {
    const events = [
      makePrioritizedEvent("high"),
      makePrioritizedEvent("low"),
      makePrioritizedEvent("normal"),
    ];
    queue.enqueueAll(events);
    expect(queue.size).toBe(3);
  });

  it("drops lowest priority events when full (max 500)", () => {
    // Fill with 500 normal events
    for (let i = 0; i < 500; i++) {
      queue.enqueue(makePrioritizedEvent("normal"));
    }
    expect(queue.size).toBe(500);

    // Add a critical event — should evict the oldest low-priority-bucket event
    // Since all are "normal", it evicts from normal
    queue.enqueue(makePrioritizedEvent("critical"));
    expect(queue.size).toBe(500); // still 500, not 501

    // The critical event should be first
    expect(queue.peek()!.priority).toBe("critical");
  });

  it("evicts from lowest priority bucket first when full", () => {
    // Fill 250 high, 250 low
    for (let i = 0; i < 250; i++) {
      queue.enqueue(makePrioritizedEvent("high"));
    }
    for (let i = 0; i < 250; i++) {
      queue.enqueue(makePrioritizedEvent("low"));
    }
    expect(queue.size).toBe(500);

    // Add a critical event — should evict from the "low" bucket
    queue.enqueue(makePrioritizedEvent("critical"));
    expect(queue.size).toBe(500);

    // Drain and count
    const all = queue.drain();
    const criticals = all.filter((e) => e.priority === "critical");
    const highs = all.filter((e) => e.priority === "high");
    const lows = all.filter((e) => e.priority === "low");

    expect(criticals).toHaveLength(1);
    expect(highs).toHaveLength(250);
    expect(lows).toHaveLength(249); // one evicted
  });
});

// ===========================================================================
// EVENT DISPATCHER
// ===========================================================================

describe("EventDispatcher", () => {
  let dispatcher: EventDispatcher;

  beforeEach(() => {
    dispatcher = new EventDispatcher();
  });

  describe("formatEventForAgent", () => {
    it("formats an unassigned order event", () => {
      const pe: PrioritizedEvent = {
        event: {
          type: "unassigned_order",
          orderId: "order-123",
          orderIdKey: "order123",
          restaurantName: "Pizza Palace",
          deliveryZone: "Perth",
          minutesPending: 5,
        },
        priority: "high",
        createdAt: new Date(),
      };

      const result = dispatcher.formatEventForAgent(pe);
      expect(result).toContain("[HIGH]");
      expect(result).toContain("order123");
      expect(result).toContain("Pizza Palace");
      expect(result).toContain("Perth");
      expect(result).toContain("5 minutes");
    });

    it("formats a driver offline event", () => {
      const pe: PrioritizedEvent = {
        event: {
          type: "driver_offline",
          driverId: "driver@test.com",
          driverName: "Jane Smith",
          activeOrders: 2,
        },
        priority: "critical",
        createdAt: new Date(),
      };

      const result = dispatcher.formatEventForAgent(pe);
      expect(result).toContain("[CRITICAL]");
      expect(result).toContain("Jane Smith");
      expect(result).toContain("driver@test.com");
      expect(result).toContain("2 active orders");
    });

    it("formats a market alert event", () => {
      const pe: PrioritizedEvent = {
        event: {
          type: "market_alert",
          market: "Perth",
          score: 72,
          idealDrivers: 5,
          availableDrivers: 2,
          alertLevel: "warning",
        },
        priority: "normal",
        createdAt: new Date(),
      };

      const result = dispatcher.formatEventForAgent(pe);
      expect(result).toContain("[NORMAL]");
      expect(result).toContain("Perth");
      expect(result).toContain("72");
      expect(result).toContain("WARNING");
      expect(result).toContain("2 drivers");
    });

    it("formats a new driver message event", () => {
      const pe: PrioritizedEvent = {
        event: {
          type: "new_driver_message",
          driverId: "bob@test.com",
          driverName: "Bob Jones",
          message: "I'm running late",
          timestamp: new Date(),
        },
        priority: "high",
        createdAt: new Date(),
      };

      const result = dispatcher.formatEventForAgent(pe);
      expect(result).toContain("[HIGH]");
      expect(result).toContain("Bob Jones");
      expect(result).toContain("I'm running late");
    });

    it("formats a ticket update event", () => {
      const pe: PrioritizedEvent = {
        event: {
          type: "ticket_update",
          ticketId: "abc12345",
          status: "New",
          category: "Order Issue",
          market: "Perth",
        },
        priority: "normal",
        createdAt: new Date(),
      };

      const result = dispatcher.formatEventForAgent(pe);
      expect(result).toContain("[NORMAL]");
      expect(result).toContain("abc12345");
      expect(result).toContain("Order Issue");
      expect(result).toContain("New");
    });

    it("formats a shift event", () => {
      const pe: PrioritizedEvent = {
        event: { type: "shift_event", event: "approaching_end" },
        priority: "normal",
        createdAt: new Date(),
      };

      const result = dispatcher.formatEventForAgent(pe);
      expect(result).toContain("approaching its end");
    });
  });

  describe("buildDispatchMessage", () => {
    it("builds a combined message with numbered events", () => {
      const events: PrioritizedEvent[] = [
        {
          event: {
            type: "driver_offline",
            driverId: "driver@test.com",
            driverName: "Jane",
            activeOrders: 2,
          },
          priority: "critical",
          createdAt: new Date(),
        },
        {
          event: {
            type: "unassigned_order",
            orderId: "o-1",
            orderIdKey: "o1",
            restaurantName: "Pizza Palace",
            deliveryZone: "Perth",
            minutesPending: 5,
          },
          priority: "high",
          createdAt: new Date(),
        },
        {
          event: {
            type: "market_alert",
            market: "Perth",
            score: 72,
            idealDrivers: 5,
            availableDrivers: 2,
            alertLevel: "warning",
          },
          priority: "normal",
          createdAt: new Date(),
        },
      ];

      const result = dispatcher.buildDispatchMessage(events);

      // Starts with header
      expect(result).toContain("PRIORITY EVENTS:");

      // Numbered lines
      expect(result).toContain("1. [CRITICAL]");
      expect(result).toContain("2. [HIGH]");
      expect(result).toContain("3. [NORMAL]");

      // Summary footer
      expect(result).toContain("Summary: 3 events");
      expect(result).toContain("1 CRITICAL");
      expect(result).toContain("1 HIGH");
      expect(result).toContain("1 NORMAL");
    });

    it("groups events by priority level (critical first)", () => {
      const events: PrioritizedEvent[] = [
        makePrioritizedEvent("normal"),
        makePrioritizedEvent("critical"),
        makePrioritizedEvent("high"),
      ];

      const result = dispatcher.buildDispatchMessage(events);
      const lines = result.split("\n");

      // Find the numbered lines
      const numbered = lines.filter((l) => /^\d+\./.test(l));
      expect(numbered[0]).toContain("[CRITICAL]");
      expect(numbered[1]).toContain("[HIGH]");
      expect(numbered[2]).toContain("[NORMAL]");
    });

    it("returns a no-events message when given an empty array", () => {
      const result = dispatcher.buildDispatchMessage([]);
      expect(result).toContain("No events to process");
    });
  });
});
