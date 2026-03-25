/**
 * Unit tests for the Sisyphus ontology layer:
 * - Transformers (transformOrder, transformDriver, transformRestaurant)
 * - OntologyStore (getters, filtered queries, bulk update, stats)
 * - Zod schemas (validation / rejection)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { transformOrder, transformDriver, transformRestaurant } from "@ontology/sync/transformer";
import { OntologyStore } from "@ontology/state/store";
import { OrderSchema } from "@ontology/objects/order";
import { DriverSchema } from "@ontology/objects/driver";
import type { Order, Driver } from "@ontology/objects/index";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const NOW_EPOCH = Math.floor(Date.now() / 1000);

function makeRawOrder(overrides: Record<string, unknown> = {}) {
  return {
    OrderId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    OrderIdKey: "a1b2c3d4",
    OrderStatus: "Pending",
    OrderType: "Delivery",
    DeliveryType: "Hand delivered",
    ASAP: true,
    UserId: "customer@test.com",
    DriverId: null,
    RestaurantId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    RestaurantName: "Test Restaurant",
    DeliveryZone: "Perth",
    DeliveryStreet: "123 Main St",
    DeliveryCity: "Perth",
    DeliveryProvince: "ON",
    DeliveryInstructions: "Leave at door",
    DeliveryDistance: 5200,
    CustomerLocation: { latitude: -31.95, longitude: 115.86 },
    OrderLocation: { latitude: -31.94, longitude: 115.85 },
    OrderSubtotal: 2500,
    Tax: 325,
    DeliveryFee: 500,
    Tip: 200,
    OrderTotal: 3525,
    Alcohol: false,
    OrderItems: [
      {
        ItemId: "item-uuid-1",
        ItemName: "Margherita Pizza",
        Price: 1500,
        Quantity: 1,
        Cuisine: "Italian",
        Taxable: true,
        Alcohol: false,
      },
      {
        ItemId: "item-uuid-2",
        ItemName: "Garlic Bread",
        Price: 500,
        Quantity: 2,
        Cuisine: "Italian",
        Taxable: true,
        Alcohol: false,
      },
    ],
    OrderCreatedTime: NOW_EPOCH - 600,
    OrderPlacedTime: NOW_EPOCH - 600,
    DeliveryConfirmedTime: null,
    DriverAssignedTime: null,
    OrderReadyTime: null,
    OrderInBagTime: null,
    EnrouteTime: null,
    OrderInTransitTime: null,
    AtCustomerTime: null,
    OrderDeliveredTime: null,
    TravelTime: null,
    EnrouteDuration: null,
    ...overrides,
  };
}

function makeRawDriver(overrides: Record<string, unknown> = {}) {
  return {
    DriverId: "driver@test.com",
    FullName: "Jane Smith",
    Phone: "555-0100",
    AgentId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
    DispatchZone: "Perth",
    DeliveryArea: "Perth",
    ignoreArea: false,
    Available: true,
    Paused: false,
    Active: true,
    ConnectionId: "conn-abc123",
    AppVersion: "4.2.1",
    phoneModel: "iPhone 15",
    AppSetting: {
      Camera: "Full",
      GeoLocate: "Full",
      Microphone: "Partial",
      Phone: "Full",
      Speech: "No",
    },
    TrainingOrders: 12,
    ...overrides,
  };
}

function makeRawRestaurant(overrides: Record<string, unknown> = {}) {
  return {
    RestaurantId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    RestaurantIdKey: "d4e5f6a7",
    RestaurantName: "Pizza Palace",
    Phone: "555-0200",
    Email: "pizza@palace.com",
    City: "Perth",
    Province: "ON",
    DeliveryZone: "Perth",
    PrimaryCuisine: "Italian",
    Price: 2,
    Restaurant: true,
    DeliveryAvailable: true,
    Commission: 0.85,
    POSETA: 25,
    KitchenHours: {
      Mon: { open: 660, closed: 1320 },
      Tue: { open: 660, closed: 1320 },
      Wed: { open: 660, closed: 1320 },
      Thu: { open: 660, closed: 1320 },
      Fri: { open: 660, closed: 1380 },
      Sat: { open: 540, closed: 1380 },
      Sun: { open: 540, closed: 1320 },
    },
    LastHeartbeat: NOW_EPOCH - 60, // 1 minute ago => online
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: build a valid Order object (for store tests, bypassing transformer)
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
    restaurantName: "Test Restaurant",
    deliveryZone: "Perth",
    subtotal: 2500 as any,
    tax: 325 as any,
    deliveryFee: 500 as any,
    tip: 200 as any,
    total: 3525 as any,
    hasAlcohol: false,
    items: [],
    createdAt: new Date(),
    placedAt: new Date(),
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

// ===========================================================================
// TRANSFORMERS
// ===========================================================================

describe("Transformers", () => {
  // -----------------------------------------------------------------------
  // transformOrder
  // -----------------------------------------------------------------------

  describe("transformOrder", () => {
    it("maps DynamoDB field names to ontology camelCase properties", () => {
      const raw = makeRawOrder();
      const order = transformOrder(raw);

      expect(order.orderId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      expect(order.orderIdKey).toBe("a1b2c3d4");
      expect(order.status).toBe("Pending");
      expect(order.orderType).toBe("Delivery");
      expect(order.deliveryType).toBe("Hand delivered");
      expect(order.isAsap).toBe(true);
      expect(order.customerId).toBe("customer@test.com");
      expect(order.driverId).toBeNull();
      expect(order.restaurantId).toBe("b2c3d4e5-f6a7-8901-bcde-f12345678901");
      expect(order.restaurantName).toBe("Test Restaurant");
      expect(order.deliveryZone).toBe("Perth");
    });

    it("maps monetary values as cents (integers)", () => {
      const order = transformOrder(makeRawOrder());

      expect(order.subtotal).toBe(2500);
      expect(order.tax).toBe(325);
      expect(order.deliveryFee).toBe(500);
      expect(order.tip).toBe(200);
      expect(order.total).toBe(3525);
    });

    it("transforms OrderItems array with correct field mapping", () => {
      const order = transformOrder(makeRawOrder());

      expect(order.items).toHaveLength(2);
      expect(order.items[0].itemId).toBe("item-uuid-1");
      expect(order.items[0].itemName).toBe("Margherita Pizza");
      expect(order.items[0].price).toBe(1500);
      expect(order.items[0].quantity).toBe(1);
      expect(order.items[0].cuisine).toBe("Italian");
      expect(order.items[1].itemName).toBe("Garlic Bread");
      expect(order.items[1].quantity).toBe(2);
    });

    it("converts epoch seconds to Date objects for lifecycle timestamps", () => {
      const createdEpoch = NOW_EPOCH - 600;
      const order = transformOrder(makeRawOrder({ OrderCreatedTime: createdEpoch }));

      expect(order.createdAt).toBeInstanceOf(Date);
      expect(order.createdAt.getTime()).toBe(createdEpoch * 1000);
    });

    it("sets null for optional lifecycle timestamps that are absent", () => {
      const order = transformOrder(makeRawOrder());

      expect(order.confirmedAt).toBeNull();
      expect(order.driverAssignedAt).toBeNull();
      expect(order.readyAt).toBeNull();
      expect(order.deliveredAt).toBeNull();
    });

    it("maps GeoPoint fields (CustomerLocation, OrderLocation)", () => {
      const order = transformOrder(makeRawOrder());

      expect(order.customerLocation).toEqual({ latitude: -31.95, longitude: 115.86 });
      expect(order.orderLocation).toEqual({ latitude: -31.94, longitude: 115.85 });
    });

    it("handles null geo fields gracefully", () => {
      const order = transformOrder(
        makeRawOrder({ CustomerLocation: null, OrderLocation: null }),
      );

      expect(order.customerLocation).toBeNull();
      expect(order.orderLocation).toBeNull();
    });

    it("maps driverId to string when present", () => {
      const order = transformOrder(makeRawOrder({ DriverId: "driver@test.com" }));
      expect(order.driverId).toBe("driver@test.com");
    });

    it("computes isLate = false for a recently placed order", () => {
      const order = transformOrder(
        makeRawOrder({ OrderPlacedTime: NOW_EPOCH - 300 }), // 5 min ago
      );
      expect(order.isLate).toBe(false);
    });

    it("computes isLate = true when order placed >45 minutes ago and not delivered", () => {
      const order = transformOrder(
        makeRawOrder({
          OrderPlacedTime: NOW_EPOCH - 3000, // 50 min ago
          OrderStatus: "Confirmed",
        }),
      );
      expect(order.isLate).toBe(true);
    });

    it("computes isLate = true when food is ready and sitting >15 minutes", () => {
      const order = transformOrder(
        makeRawOrder({
          OrderPlacedTime: NOW_EPOCH - 1200, // 20 min ago (not >45)
          OrderReadyTime: NOW_EPOCH - 1200, // ready 20 min ago (>15)
          OrderStatus: "Ready",
        }),
      );
      expect(order.isLate).toBe(true);
    });

    it("computes isLate = false for Completed orders regardless of timing", () => {
      const order = transformOrder(
        makeRawOrder({
          OrderPlacedTime: NOW_EPOCH - 5000,
          OrderReadyTime: NOW_EPOCH - 4000,
          OrderStatus: "Completed",
        }),
      );
      expect(order.isLate).toBe(false);
    });

    it("computes isLate = false for Cancelled orders regardless of timing", () => {
      const order = transformOrder(
        makeRawOrder({
          OrderPlacedTime: NOW_EPOCH - 5000,
          OrderStatus: "Cancelled",
        }),
      );
      expect(order.isLate).toBe(false);
    });

    it("computes waitTimeMinutes as minutes since placed", () => {
      const order = transformOrder(
        makeRawOrder({ OrderPlacedTime: NOW_EPOCH - 600 }),
      );
      expect(order.waitTimeMinutes).toBe(10);
    });

    it("computes timeSinceReady when OrderReadyTime is set", () => {
      const order = transformOrder(
        makeRawOrder({ OrderReadyTime: NOW_EPOCH - 300 }),
      );
      expect(order.timeSinceReady).toBe(5);
    });

    it("sets timeSinceReady to null when OrderReadyTime is absent", () => {
      const order = transformOrder(makeRawOrder());
      expect(order.timeSinceReady).toBeNull();
    });

    it("handles empty OrderItems gracefully", () => {
      const order = transformOrder(makeRawOrder({ OrderItems: [] }));
      expect(order.items).toEqual([]);
    });

    it("handles missing OrderItems field gracefully", () => {
      const raw = makeRawOrder();
      delete (raw as any).OrderItems;
      const order = transformOrder(raw);
      expect(order.items).toEqual([]);
    });

    it("defaults to 'Delivery' when OrderType is missing", () => {
      const raw = makeRawOrder();
      delete (raw as any).OrderType;
      const order = transformOrder(raw);
      expect(order.orderType).toBe("Delivery");
    });
  });

  // -----------------------------------------------------------------------
  // transformDriver
  // -----------------------------------------------------------------------

  describe("transformDriver", () => {
    it("maps DynamoDB field names to ontology camelCase properties", () => {
      const raw = makeRawDriver();
      const driver = transformDriver(raw);

      expect(driver.driverId).toBe("driver@test.com");
      expect(driver.name).toBe("Jane Smith");
      expect(driver.phone).toBe("555-0100");
      expect(driver.agentId).toBe("c3d4e5f6-a7b8-9012-cdef-123456789012");
      expect(driver.dispatchZone).toBe("Perth");
      expect(driver.deliveryArea).toBe("Perth");
      expect(driver.ignoreArea).toBe(false);
    });

    it("maps raw boolean flags (Available, Paused, Active)", () => {
      const driver = transformDriver(makeRawDriver());

      expect(driver.isAvailable).toBe(true);
      expect(driver.isPaused).toBe(false);
      expect(driver.isActive).toBe(true);
    });

    it("maps connection and device fields", () => {
      const driver = transformDriver(makeRawDriver());

      expect(driver.connectionId).toBe("conn-abc123");
      expect(driver.appVersion).toBe("4.2.1");
      expect(driver.phoneModel).toBe("iPhone 15");
      expect(driver.trainingOrders).toBe(12);
    });

    it("transforms AppSetting sub-object", () => {
      const driver = transformDriver(makeRawDriver());

      expect(driver.appSettings).toEqual({
        camera: "Full",
        geoLocate: "Full",
        microphone: "Partial",
        phone: "Full",
        speech: "No",
      });
    });

    it("computes isOnline = true when Available && !Paused && ConnectionId present", () => {
      const driver = transformDriver(makeRawDriver());
      expect(driver.isOnline).toBe(true);
      expect(driver.status).toBe("Online");
    });

    it("computes isOnline = false when Paused", () => {
      const driver = transformDriver(makeRawDriver({ Paused: true }));
      expect(driver.isOnline).toBe(false);
      expect(driver.status).toBe("OnBreak");
    });

    it("computes status = Offline when not Available", () => {
      const driver = transformDriver(makeRawDriver({ Available: false }));
      expect(driver.isOnline).toBe(false);
      expect(driver.status).toBe("Offline");
    });

    it("computes status = Offline when ConnectionId is null", () => {
      const driver = transformDriver(makeRawDriver({ ConnectionId: null }));
      expect(driver.isOnline).toBe(false);
      expect(driver.status).toBe("Offline");
    });

    it("computes status = Inactive when Active is false", () => {
      const driver = transformDriver(makeRawDriver({ Active: false }));
      expect(driver.status).toBe("Inactive");
    });

    it("Inactive takes priority over OnBreak", () => {
      const driver = transformDriver(
        makeRawDriver({ Active: false, Paused: true }),
      );
      expect(driver.status).toBe("Inactive");
    });

    it("OnBreak takes priority over Offline", () => {
      const driver = transformDriver(
        makeRawDriver({ Paused: true, Available: false }),
      );
      expect(driver.status).toBe("OnBreak");
    });

    it("initializes activeOrdersCount to 0", () => {
      const driver = transformDriver(makeRawDriver());
      expect(driver.activeOrdersCount).toBe(0);
    });

    it("handles missing optional fields without crashing", () => {
      const minimal = {
        DriverId: "min@test.com",
        FullName: "Min Driver",
        Phone: "555-0000",
        DispatchZone: "Perth",
        DeliveryArea: "Perth",
        ignoreArea: false,
        Available: false,
        Paused: false,
        Active: true,
        ConnectionId: null,
      };
      const driver = transformDriver(minimal);

      expect(driver.driverId).toBe("min@test.com");
      expect(driver.agentId).toBeUndefined();
      expect(driver.appVersion).toBeUndefined();
      expect(driver.phoneModel).toBeUndefined();
      expect(driver.appSettings).toBeUndefined();
      expect(driver.trainingOrders).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // transformRestaurant
  // -----------------------------------------------------------------------

  describe("transformRestaurant", () => {
    it("maps DynamoDB field names to ontology camelCase properties", () => {
      const raw = makeRawRestaurant();
      const rest = transformRestaurant(raw);

      expect(rest.restaurantId).toBe("d4e5f6a7-b8c9-0123-defa-234567890123");
      expect(rest.restaurantIdKey).toBe("d4e5f6a7");
      expect(rest.name).toBe("Pizza Palace");
      expect(rest.phone).toBe("555-0200");
      expect(rest.email).toBe("pizza@palace.com");
      expect(rest.city).toBe("Perth");
      expect(rest.province).toBe("ON");
      expect(rest.deliveryZone).toBe("Perth");
      expect(rest.cuisine).toBe("Italian");
      expect(rest.priceLevel).toBe(2);
    });

    it("maps operational flags", () => {
      const rest = transformRestaurant(makeRawRestaurant());

      expect(rest.isActive).toBe(true);
      expect(rest.deliveryAvailable).toBe(true);
      expect(rest.commission).toBe(0.85);
      expect(rest.posEta).toBe(25);
    });

    it("computes isTabletOnline = true when heartbeat is recent (<5 min)", () => {
      const rest = transformRestaurant(
        makeRawRestaurant({ LastHeartbeat: NOW_EPOCH - 60 }),
      );
      expect(rest.isTabletOnline).toBe(true);
    });

    it("computes isTabletOnline = false when heartbeat is stale (>5 min)", () => {
      const rest = transformRestaurant(
        makeRawRestaurant({ LastHeartbeat: NOW_EPOCH - 600 }),
      );
      expect(rest.isTabletOnline).toBe(false);
    });

    it("computes isTabletOnline = false when LastHeartbeat is absent", () => {
      const raw = makeRawRestaurant();
      delete (raw as any).LastHeartbeat;
      const rest = transformRestaurant(raw);
      expect(rest.isTabletOnline).toBe(false);
    });

    it("transforms KitchenHours with day-level open/closed", () => {
      const rest = transformRestaurant(makeRawRestaurant());

      expect(rest.kitchenHours).toBeDefined();
      expect(rest.kitchenHours!.Mon).toEqual({
        open: expect.any(Number),
        closed: expect.any(Number),
      });
      // 660 minutes = 11:00 AM, 1320 = 10:00 PM
      expect(Number(rest.kitchenHours!.Mon!.open)).toBe(660);
      expect(Number(rest.kitchenHours!.Mon!.closed)).toBe(1320);
    });

    it("computes isOpen based on current time and kitchen hours", () => {
      // isOpen depends on the system clock and current day; just verify it returns a boolean
      const rest = transformRestaurant(makeRawRestaurant());
      expect(typeof rest.isOpen).toBe("boolean");
    });

    it("computes isOpen = false when KitchenHours is missing", () => {
      const raw = makeRawRestaurant();
      delete (raw as any).KitchenHours;
      const rest = transformRestaurant(raw);
      expect(rest.isOpen).toBe(false);
    });

    it("initializes currentLoad to 0", () => {
      const rest = transformRestaurant(makeRawRestaurant());
      expect(rest.currentLoad).toBe(0);
    });
  });
});

// ===========================================================================
// ONTOLOGY STORE
// ===========================================================================

describe("OntologyStore", () => {
  let store: OntologyStore;

  beforeEach(() => {
    store = new OntologyStore();
  });

  // -----------------------------------------------------------------------
  // Single-entity getters
  // -----------------------------------------------------------------------

  describe("getOrder / getDriver", () => {
    it("returns undefined for missing order", () => {
      expect(store.getOrder("nonexistent")).toBeUndefined();
    });

    it("returns undefined for missing driver", () => {
      expect(store.getDriver("nonexistent")).toBeUndefined();
    });

    it("returns an order after updateOrders populates the store", () => {
      const order = buildOrder();
      store.updateOrders([order]);

      const found = store.getOrder(order.orderId);
      expect(found).toBeDefined();
      expect(found!.orderId).toBe(order.orderId);
      expect(found!.restaurantName).toBe("Test Restaurant");
    });

    it("returns a driver after updateDrivers populates the store", () => {
      const driver = buildDriver();
      store.updateDrivers([driver]);

      const found = store.getDriver(driver.driverId);
      expect(found).toBeDefined();
      expect(found!.name).toBe("Jane Smith");
    });
  });

  // -----------------------------------------------------------------------
  // queryOrders
  // -----------------------------------------------------------------------

  describe("queryOrders", () => {
    const pendingPerth = buildOrder({
      orderId: "00000000-0000-0000-0000-000000000001",
      status: "Pending",
      deliveryZone: "Perth",
    });
    const confirmedPerth = buildOrder({
      orderId: "00000000-0000-0000-0000-000000000002",
      status: "Confirmed",
      deliveryZone: "Perth",
    });
    const pendingMelbourne = buildOrder({
      orderId: "00000000-0000-0000-0000-000000000003",
      status: "Pending",
      deliveryZone: "Melbourne",
    });

    beforeEach(() => {
      store.updateOrders([pendingPerth, confirmedPerth, pendingMelbourne]);
    });

    it("returns all orders when filter is empty", () => {
      expect(store.queryOrders({})).toHaveLength(3);
    });

    it("filters by status", () => {
      const results = store.queryOrders({ status: "Pending" });
      expect(results).toHaveLength(2);
      expect(results.every((o) => o.status === "Pending")).toBe(true);
    });

    it("filters by deliveryZone", () => {
      const results = store.queryOrders({ deliveryZone: "Perth" });
      expect(results).toHaveLength(2);
      expect(results.every((o) => o.deliveryZone === "Perth")).toBe(true);
    });

    it("filters by status AND deliveryZone", () => {
      const results = store.queryOrders({ status: "Pending", deliveryZone: "Perth" });
      expect(results).toHaveLength(1);
      expect(results[0].orderId).toBe(pendingPerth.orderId);
    });

    it("filters by driverId", () => {
      const withDriver = buildOrder({
        orderId: "00000000-0000-0000-0000-000000000004",
        driverId: "driver@test.com",
      });
      store.updateOrders([pendingPerth, withDriver]);

      const results = store.queryOrders({ driverId: "driver@test.com" });
      expect(results).toHaveLength(1);
      expect(results[0].driverId).toBe("driver@test.com");
    });

    it("returns empty array when no orders match", () => {
      const results = store.queryOrders({ status: "Completed" });
      expect(results).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // queryDrivers
  // -----------------------------------------------------------------------

  describe("queryDrivers", () => {
    const onlinePerth = buildDriver({
      driverId: "online-perth@test.com",
      dispatchZone: "Perth",
      isAvailable: true,
      isOnline: true,
    });
    const offlinePerth = buildDriver({
      driverId: "offline-perth@test.com",
      dispatchZone: "Perth",
      isAvailable: false,
      isOnline: false,
    });
    const onlineMelbourne = buildDriver({
      driverId: "online-melb@test.com",
      dispatchZone: "Melbourne",
      isAvailable: true,
      isOnline: true,
    });

    beforeEach(() => {
      store.updateDrivers([onlinePerth, offlinePerth, onlineMelbourne]);
    });

    it("returns all drivers when filter is empty", () => {
      expect(store.queryDrivers({})).toHaveLength(3);
    });

    it("filters by dispatchZone", () => {
      const results = store.queryDrivers({ dispatchZone: "Perth" });
      expect(results).toHaveLength(2);
    });

    it("filters by isAvailable", () => {
      const results = store.queryDrivers({ isAvailable: true });
      expect(results).toHaveLength(2);
    });

    it("filters by isOnline", () => {
      const results = store.queryDrivers({ isOnline: true });
      expect(results).toHaveLength(2);
      expect(results.every((d) => d.isOnline)).toBe(true);
    });

    it("filters by dispatchZone AND isOnline", () => {
      const results = store.queryDrivers({ dispatchZone: "Perth", isOnline: true });
      expect(results).toHaveLength(1);
      expect(results[0].driverId).toBe("online-perth@test.com");
    });
  });

  // -----------------------------------------------------------------------
  // updateOrders (bulk replace)
  // -----------------------------------------------------------------------

  describe("updateOrders", () => {
    it("replaces all existing data on each call", () => {
      store.updateOrders([buildOrder({ orderId: "00000000-0000-0000-0000-000000000001" })]);
      expect(store.orders.size).toBe(1);

      store.updateOrders([
        buildOrder({ orderId: "00000000-0000-0000-0000-000000000002" }),
        buildOrder({ orderId: "00000000-0000-0000-0000-000000000003" }),
      ]);
      expect(store.orders.size).toBe(2);
      expect(store.getOrder("00000000-0000-0000-0000-000000000001")).toBeUndefined();
    });

    it("clears all data when updated with empty array", () => {
      store.updateOrders([buildOrder()]);
      expect(store.orders.size).toBe(1);

      store.updateOrders([]);
      expect(store.orders.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // getStats
  // -----------------------------------------------------------------------

  describe("getStats", () => {
    it("returns correct counts after populating collections", () => {
      store.updateOrders([buildOrder(), buildOrder({ orderId: "00000000-0000-0000-0000-000000000099" })]);
      store.updateDrivers([buildDriver()]);

      const stats = store.getStats();
      expect(stats.orders).toBe(2);
      expect(stats.drivers).toBe(1);
      expect(stats.restaurants).toBe(0);
      expect(stats.customers).toBe(0);
      expect(stats.tickets).toBe(0);
      expect(stats.markets).toBe(0);
      expect(stats.conversations).toBe(0);
    });

    it("returns lastSyncedAt = null initially", () => {
      const stats = store.getStats();
      expect(stats.lastSyncedAt).toBeNull();
    });

    it("returns lastSyncedAt as Date after markSynced()", () => {
      store.markSynced();
      const stats = store.getStats();
      expect(stats.lastSyncedAt).toBeInstanceOf(Date);
    });
  });
});

// ===========================================================================
// ZOD SCHEMAS
// ===========================================================================

describe("Schemas", () => {
  describe("OrderSchema", () => {
    it("parses a valid order object", () => {
      const validOrder = {
        orderId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        orderIdKey: "a1b2c3d4",
        status: "Pending",
        orderType: "Delivery",
        deliveryType: "Hand delivered",
        isAsap: true,
        customerId: "customer@test.com",
        driverId: null,
        restaurantId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        restaurantName: "Test Restaurant",
        deliveryZone: "Perth",
        subtotal: 2500,
        tax: 325,
        deliveryFee: 500,
        tip: 200,
        total: 3525,
        hasAlcohol: false,
        items: [
          {
            itemId: "item-1",
            itemName: "Pizza",
            price: 1500,
            quantity: 1,
          },
        ],
        createdAt: new Date(),
        placedAt: new Date(),
        confirmedAt: null,
        isLate: false,
        waitTimeMinutes: 10,
        timeSinceReady: null,
      };

      const result = OrderSchema.safeParse(validOrder);
      expect(result.success).toBe(true);
    });

    it("rejects an invalid OrderStatus enum value", () => {
      const badOrder = {
        orderId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        orderIdKey: "a1b2c3d4",
        status: "InvalidStatus",
        orderType: "Delivery",
        isAsap: true,
        customerId: "customer@test.com",
        driverId: null,
        restaurantId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        restaurantName: "Test Restaurant",
        deliveryZone: "Perth",
        subtotal: 2500,
        tax: 325,
        deliveryFee: 500,
        tip: 200,
        total: 3525,
        hasAlcohol: false,
        items: [],
        createdAt: new Date(),
        placedAt: new Date(),
        isLate: false,
        waitTimeMinutes: 0,
        timeSinceReady: null,
      };

      const result = OrderSchema.safeParse(badOrder);
      expect(result.success).toBe(false);
    });

    it("rejects when required field orderId is missing", () => {
      const noId = {
        orderIdKey: "a1b2c3d4",
        status: "Pending",
        orderType: "Delivery",
        isAsap: true,
        customerId: "customer@test.com",
        driverId: null,
        restaurantId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        restaurantName: "Test Restaurant",
        deliveryZone: "Perth",
        subtotal: 2500,
        tax: 325,
        deliveryFee: 500,
        tip: 200,
        total: 3525,
        hasAlcohol: false,
        items: [],
        createdAt: new Date(),
        placedAt: new Date(),
        isLate: false,
        waitTimeMinutes: 0,
        timeSinceReady: null,
      };

      const result = OrderSchema.safeParse(noId);
      expect(result.success).toBe(false);
    });

    it("rejects when orderId is not a valid UUID", () => {
      const badUuid = {
        orderId: "not-a-uuid",
        orderIdKey: "not-a-uu",
        status: "Pending",
        orderType: "Delivery",
        isAsap: true,
        customerId: "customer@test.com",
        driverId: null,
        restaurantId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        restaurantName: "Test Restaurant",
        deliveryZone: "Perth",
        subtotal: 2500,
        tax: 325,
        deliveryFee: 500,
        tip: 200,
        total: 3525,
        hasAlcohol: false,
        items: [],
        createdAt: new Date(),
        placedAt: new Date(),
        isLate: false,
        waitTimeMinutes: 0,
        timeSinceReady: null,
      };

      const result = OrderSchema.safeParse(badUuid);
      expect(result.success).toBe(false);
    });

    it("rejects when customerId is not an email", () => {
      const badEmail = {
        orderId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        orderIdKey: "a1b2c3d4",
        status: "Pending",
        orderType: "Delivery",
        isAsap: true,
        customerId: "not-an-email",
        driverId: null,
        restaurantId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        restaurantName: "Test Restaurant",
        deliveryZone: "Perth",
        subtotal: 2500,
        tax: 325,
        deliveryFee: 500,
        tip: 200,
        total: 3525,
        hasAlcohol: false,
        items: [],
        createdAt: new Date(),
        placedAt: new Date(),
        isLate: false,
        waitTimeMinutes: 0,
        timeSinceReady: null,
      };

      const result = OrderSchema.safeParse(badEmail);
      expect(result.success).toBe(false);
    });

    it("rejects non-integer monetary values", () => {
      const floatMoney = {
        orderId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        orderIdKey: "a1b2c3d4",
        status: "Pending",
        orderType: "Delivery",
        isAsap: true,
        customerId: "customer@test.com",
        driverId: null,
        restaurantId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        restaurantName: "Test Restaurant",
        deliveryZone: "Perth",
        subtotal: 25.99, // should be int cents
        tax: 325,
        deliveryFee: 500,
        tip: 200,
        total: 3525,
        hasAlcohol: false,
        items: [],
        createdAt: new Date(),
        placedAt: new Date(),
        isLate: false,
        waitTimeMinutes: 0,
        timeSinceReady: null,
      };

      const result = OrderSchema.safeParse(floatMoney);
      expect(result.success).toBe(false);
    });
  });

  describe("DriverSchema", () => {
    it("parses a valid driver object", () => {
      const validDriver = {
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
        connectionId: "conn-abc",
        status: "Online",
        isOnline: true,
        activeOrdersCount: 2,
      };

      const result = DriverSchema.safeParse(validDriver);
      expect(result.success).toBe(true);
    });

    it("rejects invalid DriverStatus enum", () => {
      const badStatus = {
        driverId: "driver@test.com",
        name: "Jane Smith",
        phone: "555-0100",
        dispatchZone: "Perth",
        deliveryArea: "Perth",
        ignoreArea: false,
        isAvailable: true,
        isPaused: false,
        isActive: true,
        connectionId: null,
        status: "Sleeping", // invalid
        isOnline: false,
        activeOrdersCount: 0,
      };

      const result = DriverSchema.safeParse(badStatus);
      expect(result.success).toBe(false);
    });

    it("rejects when driverId is not an email", () => {
      const badEmail = {
        driverId: "not-an-email",
        name: "Jane Smith",
        phone: "555-0100",
        dispatchZone: "Perth",
        deliveryArea: "Perth",
        ignoreArea: false,
        isAvailable: true,
        isPaused: false,
        isActive: true,
        connectionId: null,
        status: "Offline",
        isOnline: false,
        activeOrdersCount: 0,
      };

      const result = DriverSchema.safeParse(badEmail);
      expect(result.success).toBe(false);
    });
  });
});
