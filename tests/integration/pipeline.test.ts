/**
 * End-to-end pipeline integration test.
 *
 * Proves the full Sisyphus pipeline works in isolation:
 *   OntologyStore (fake data) → Tools (query) → Guardrails (validate) → Action (execute)
 *
 * No live infrastructure needed — everything runs in-memory with mocks.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { OntologyStore } from "@ontology/state/store.js";
import {
  transformOrder,
  transformDriver,
  transformRestaurant,
  transformMarket,
  transformTicket,
} from "@ontology/sync/transformer.js";
import { clearActions, defineAction, getAction } from "@guardrails/registry.js";
import { registerAllActions } from "@ontology/actions/index.js";
import { executeAction } from "@guardrails/executor.js";
import { listActions } from "@guardrails/registry.js";
import { createOntologyTools } from "../../src/tools/ontology-tools.js";
import { createMockRedis } from "../helpers/mock-redis.js";
import type { AuditRecord } from "@guardrails/types.js";

// ---------------------------------------------------------------------------
// Fake DynamoDB-shaped data (matches real field names from data discovery)
// ---------------------------------------------------------------------------

const NOW_EPOCH = Math.floor(Date.now() / 1000);

const RAW_ORDERS = [
  {
    OrderId: "order-001-uuid",
    OrderIdKey: "order-00",
    OrderStatus: "Pending",
    OrderType: "Delivery",
    UserId: "customer1@test.com",
    DriverId: null,
    RestaurantId: "rest-001-uuid",
    RestaurantName: "Pizza Palace",
    DeliveryZone: "Perth",
    OrderSubtotal: 2500,
    Tax: 325,
    DeliveryFee: 400,
    Tip: 300,
    OrderTotal: 3525,
    OrderCreatedTime: NOW_EPOCH - 600,
    OrderPlacedTime: NOW_EPOCH - 600,
    ASAP: true,
    Alcohol: false,
  },
  {
    OrderId: "order-002-uuid",
    OrderIdKey: "order-02",
    OrderStatus: "Pending",
    OrderType: "Delivery",
    UserId: "customer2@test.com",
    DriverId: null,
    RestaurantId: "rest-002-uuid",
    RestaurantName: "Burger Barn",
    DeliveryZone: "Pembroke",
    OrderSubtotal: 1800,
    Tax: 234,
    DeliveryFee: 400,
    Tip: 0,
    OrderTotal: 2434,
    OrderCreatedTime: NOW_EPOCH - 300,
    OrderPlacedTime: NOW_EPOCH - 300,
    ASAP: true,
    Alcohol: false,
  },
  {
    OrderId: "order-003-uuid",
    OrderIdKey: "order-03",
    OrderStatus: "Confirmed",
    OrderType: "Delivery",
    UserId: "customer3@test.com",
    DriverId: "driver1@test.com",
    RestaurantId: "rest-001-uuid",
    RestaurantName: "Pizza Palace",
    DeliveryZone: "Perth",
    OrderSubtotal: 3200,
    Tax: 416,
    OrderTotal: 4016,
    OrderCreatedTime: NOW_EPOCH - 1200,
    OrderPlacedTime: NOW_EPOCH - 1200,
    DriverAssignedTime: NOW_EPOCH - 1100,
    ASAP: true,
    Alcohol: false,
  },
  {
    OrderId: "order-004-uuid",
    OrderIdKey: "order-04",
    OrderStatus: "Ready",
    OrderType: "Delivery",
    UserId: "customer1@test.com",
    DriverId: "driver2@test.com",
    RestaurantId: "rest-002-uuid",
    RestaurantName: "Burger Barn",
    DeliveryZone: "Pembroke",
    OrderSubtotal: 1500,
    Tax: 195,
    OrderTotal: 2095,
    OrderCreatedTime: NOW_EPOCH - 1800,
    OrderPlacedTime: NOW_EPOCH - 1800,
    OrderReadyTime: NOW_EPOCH - 120,
    ASAP: true,
    Alcohol: false,
  },
  {
    OrderId: "order-005-uuid",
    OrderIdKey: "order-05",
    OrderStatus: "Completed",
    OrderType: "Delivery",
    UserId: "customer2@test.com",
    DriverId: "driver1@test.com",
    RestaurantId: "rest-001-uuid",
    RestaurantName: "Pizza Palace",
    DeliveryZone: "Perth",
    OrderSubtotal: 4000,
    Tax: 520,
    OrderTotal: 4920,
    OrderCreatedTime: NOW_EPOCH - 7200,
    OrderPlacedTime: NOW_EPOCH - 7200,
    OrderDeliveredTime: NOW_EPOCH - 3600,
    ASAP: true,
    Alcohol: false,
  },
];

const RAW_DRIVERS = [
  {
    DriverId: "driver1@test.com",
    FullName: "Alice Driver",
    Phone: "(613) 555-0001",
    DispatchZone: "Perth",
    DeliveryArea: "Perth",
    Available: true,
    Paused: false,
    Active: true,
    ConnectionId: "conn-abc",
  },
  {
    DriverId: "driver2@test.com",
    FullName: "Bob Driver",
    Phone: "(613) 555-0002",
    DispatchZone: "Pembroke",
    DeliveryArea: "Pembroke",
    Available: true,
    Paused: false,
    Active: true,
    ConnectionId: "conn-def",
  },
  {
    DriverId: "driver3@test.com",
    FullName: "Charlie Paused",
    Phone: "(613) 555-0003",
    DispatchZone: "Perth",
    DeliveryArea: "Perth",
    Available: true,
    Paused: true,
    Active: true,
    ConnectionId: "conn-ghi",
  },
];

const RAW_RESTAURANTS = [
  {
    RestaurantId: "rest-001-uuid",
    RestaurantIdKey: "rest-001",
    RestaurantName: "Pizza Palace",
    DeliveryZone: "Perth",
    Restaurant: true,
    DeliveryAvailable: true,
    Commission: 0.87,
    POSETA: 25,
    LastHeartbeat: NOW_EPOCH - 30,
  },
  {
    RestaurantId: "rest-002-uuid",
    RestaurantIdKey: "rest-002",
    RestaurantName: "Burger Barn",
    DeliveryZone: "Pembroke",
    Restaurant: true,
    DeliveryAvailable: true,
    Commission: 0.85,
    POSETA: 20,
    LastHeartbeat: NOW_EPOCH - 60,
  },
];

const RAW_MARKETS = [
  { Market: "Perth", Score: 45, idealDrivers: 3, drivers: 2, ts: NOW_EPOCH },
  { Market: "Pembroke", Score: 85, idealDrivers: 4, drivers: 1, ts: NOW_EPOCH },
];

const RAW_TICKETS = [
  {
    IssueId: "abc12345",
    Category: "Order Issue",
    IssueType: "Other",
    IssueStatus: "New",
    Created: NOW_EPOCH - 900,
    OrderId: "order-004-uuid",
    OrderIdKey: "order-04",
    RestaurantId: "rest-002-uuid",
    RestaurantName: "Burger Barn",
    DriverId: "driver2@test.com",
    Market: "Pembroke",
    Originator: "customer1@test.com",
    Owner: "Unassigned",
    Description: "My order is taking forever",
  },
  {
    IssueId: "def67890",
    Category: "Driver Issue",
    IssueType: "Stale Driver Location",
    IssueStatus: "Pending",
    Created: NOW_EPOCH - 1800,
    DriverId: "driver3@test.com",
    Market: "Perth",
    Originator: "Supervisor",
    Owner: "agent@valleyeats.ca",
    Description: "Driver location is not updating",
  },
];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function buildStore(): OntologyStore {
  const store = new OntologyStore();

  store.updateOrders(RAW_ORDERS.map(transformOrder));
  store.updateDrivers(RAW_DRIVERS.map(transformDriver));
  store.updateRestaurants(RAW_RESTAURANTS.map(transformRestaurant));
  store.updateMarkets(RAW_MARKETS.map(transformMarket));
  store.updateTickets(RAW_TICKETS.map(transformTicket));

  return store;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("End-to-end pipeline", () => {
  let store: OntologyStore;
  let redis: ReturnType<typeof createMockRedis>;
  let auditRecords: AuditRecord[];

  beforeEach(async () => {
    // Don't clear + re-register — ESM caches modules, so dynamic import()
    // side effects only fire once. Register on first run, then leave them.
    if (listActions().length === 0) {
      await registerAllActions();
    }

    store = buildStore();
    redis = createMockRedis();
    auditRecords = [];
  });

  function ctx() {
    return {
      redis: redis as any,
      state: store as any,
      correlationId: "test-correlation",
      onAudit: (record: AuditRecord) => {
        auditRecords.push(record);
      },
    };
  }

  // -------------------------------------------------------------------------
  // Ontology store queries
  // -------------------------------------------------------------------------

  describe("OntologyStore populated with fake data", () => {
    it("has correct entity counts", () => {
      const stats = store.getStats();
      expect(stats.orders).toBe(5);
      expect(stats.drivers).toBe(3);
      expect(stats.restaurants).toBe(2);
      expect(stats.markets).toBe(2);
      expect(stats.tickets).toBe(2);
    });

    it("queries orders by status", () => {
      const pending = store.queryOrders({ status: "Pending" });
      expect(pending).toHaveLength(2);
      expect(pending.every((o) => o.status === "Pending")).toBe(true);
    });

    it("queries orders by zone", () => {
      const perth = store.queryOrders({ deliveryZone: "Perth" });
      expect(perth).toHaveLength(3);
    });

    it("queries available drivers", () => {
      const available = store.queryDrivers({ isAvailable: true });
      // driver1 and driver2 are available; driver3 is paused but Available=true
      expect(available.length).toBeGreaterThanOrEqual(2);
    });

    it("queries drivers by zone", () => {
      const perth = store.queryDrivers({ dispatchZone: "Perth" });
      expect(perth).toHaveLength(2); // driver1 and driver3
    });

    it("queries tickets by status", () => {
      const newTickets = store.queryTickets({ status: "New" });
      expect(newTickets).toHaveLength(1);
      expect(newTickets[0].issueId).toBe("abc12345");
    });

    it("resolves linked entities via getOrder", () => {
      const order = store.getOrder("order-003-uuid");
      expect(order).toBeDefined();
      expect(order!.driverId).toBe("driver1@test.com");
      expect(order!.restaurantName).toBe("Pizza Palace");
    });

    it("computes market health", () => {
      const pembroke = store.getMarket("Pembroke");
      expect(pembroke).toBeDefined();
      expect(pembroke!.score).toBe(85); // High demand
    });
  });

  // -------------------------------------------------------------------------
  // Ontology tools
  // -------------------------------------------------------------------------

  describe("Ontology tools", () => {
    it("query_orders tool returns filtered results as JSON", async () => {
      const tools = createOntologyTools(store, redis as any, "test-agent");
      const queryOrders = tools.find((t) => t.name === "query_orders");
      expect(queryOrders).toBeDefined();

      const result = await queryOrders!.invoke({ status: "Pending" });
      const parsed = JSON.parse(result);
      expect(parsed.count).toBe(2);
      expect(parsed.orders).toHaveLength(2);
      expect(parsed.orders[0].status).toBe("Pending");
    });

    it("query_drivers tool returns available drivers", async () => {
      const tools = createOntologyTools(store, redis as any, "test-agent");
      const queryDrivers = tools.find((t) => t.name === "query_drivers");

      const result = await queryDrivers!.invoke({ isAvailable: true });
      const parsed = JSON.parse(result);
      expect(parsed.count).toBeGreaterThanOrEqual(2);
      expect(parsed.drivers.length).toBeGreaterThanOrEqual(2);
    });

    it("get_order_details resolves linked entities", async () => {
      const tools = createOntologyTools(store, redis as any, "test-agent");
      const getDetails = tools.find((t) => t.name === "get_order_details");

      const result = await getDetails!.invoke({ orderId: "order-003-uuid" });
      const parsed = JSON.parse(result);
      expect(parsed.order.orderId).toBe("order-003-uuid");
    });
  });

  // -------------------------------------------------------------------------
  // Action execution with guardrails
  // -------------------------------------------------------------------------

  describe("Action execution", () => {
    it("AssignDriverToOrder succeeds for valid Pending order + available driver", async () => {
      const result = await executeAction(
        "AssignDriverToOrder",
        { orderId: "order-001-uuid", driverId: "driver1@test.com" },
        "Unassigned Pending order needs a driver",
        "test-agent",
        ctx(),
      );

      expect(result.success).toBe(true);
      expect(result.outcome).toBe("executed");
    });

    it("AssignDriverToOrder rejected for Completed order", async () => {
      const result = await executeAction(
        "AssignDriverToOrder",
        { orderId: "order-005-uuid", driverId: "driver1@test.com" },
        "Trying to assign to completed order",
        "test-agent",
        ctx(),
      );

      expect(result.success).toBe(false);
      expect(result.outcome).toBe("rejected");
      expect(result.reason).toContain("Completed");
    });

    it("AssignDriverToOrder rejected for paused driver", async () => {
      const result = await executeAction(
        "AssignDriverToOrder",
        { orderId: "order-001-uuid", driverId: "driver3@test.com" },
        "Trying paused driver",
        "test-agent",
        ctx(),
      );

      expect(result.success).toBe(false);
      expect(result.outcome).toBe("rejected");
    });

    it("AssignDriverToOrder rejected for non-existent order", async () => {
      const result = await executeAction(
        "AssignDriverToOrder",
        { orderId: "non-existent", driverId: "driver1@test.com" },
        "Order doesn't exist",
        "test-agent",
        ctx(),
      );

      expect(result.success).toBe(false);
      expect(result.outcome).toBe("rejected");
    });

    it("SendDriverMessage succeeds then cooldown blocks second attempt", async () => {
      const result1 = await executeAction(
        "SendDriverMessage",
        { driverId: "driver1@test.com", message: "Hey Alice, order incoming!" },
        "Notifying driver of assignment",
        "test-agent",
        ctx(),
      );
      expect(result1.success).toBe(true);
      expect(result1.outcome).toBe("executed");

      // Immediate second attempt should be blocked by cooldown
      const result2 = await executeAction(
        "SendDriverMessage",
        { driverId: "driver1@test.com", message: "Following up" },
        "Quick follow-up",
        "test-agent",
        ctx(),
      );
      expect(result2.success).toBe(false);
      expect(result2.outcome).toBe("cooldown_blocked");
    });

    it("CancelOrder is staged (RED tier, requires human approval)", async () => {
      const result = await executeAction(
        "CancelOrder",
        {
          orderId: "order-001-uuid",
          reason: "Customer requested cancellation",
          cancellationOwner: "Customer",
        },
        "Customer wants to cancel",
        "test-agent",
        ctx(),
      );

      expect(result.success).toBe(true);
      expect(result.outcome).toBe("staged");
    });

    it("AddTicketNote succeeds for open ticket (GREEN tier)", async () => {
      const result = await executeAction(
        "AddTicketNote",
        { ticketId: "abc12345", note: "Investigating the delay — restaurant confirmed order is being prepared." },
        "Documenting investigation progress",
        "test-agent",
        ctx(),
      );

      expect(result.success).toBe(true);
      expect(result.outcome).toBe("executed");
    });

    it("EscalateTicket succeeds for open ticket (GREEN tier)", async () => {
      const result = await executeAction(
        "EscalateTicket",
        {
          ticketId: "abc12345",
          reason: "Customer is very upset, needs manager attention",
          severity: "high",
        },
        "Customer escalation needed",
        "test-agent",
        ctx(),
      );

      expect(result.success).toBe(true);
      expect(result.outcome).toBe("executed");
    });

    it("ResolveTicket is staged (ORANGE tier)", async () => {
      const result = await executeAction(
        "ResolveTicket",
        {
          ticketId: "abc12345",
          resolution: "Issued partial refund for delay",
          resolutionType: "refund",
          refundAmount: 1000,
        },
        "Resolving with partial refund",
        "test-agent",
        ctx(),
      );

      expect(result.success).toBe(true);
      expect(result.outcome).toBe("staged");
    });

    it("Zod validation rejects invalid params", async () => {
      const result = await executeAction(
        "SendDriverMessage",
        { driverId: "driver1@test.com", message: "" }, // empty message
        "Testing validation",
        "test-agent",
        ctx(),
      );

      expect(result.success).toBe(false);
      expect(result.outcome).toBe("rejected");
    });

    it("FlagMarketIssue succeeds for known market (GREEN tier)", async () => {
      const result = await executeAction(
        "FlagMarketIssue",
        {
          market: "Pembroke",
          issueType: "low_drivers",
          severity: "high",
          details: "Only 1 driver available, 4 needed",
        },
        "Market health alert",
        "test-agent",
        ctx(),
      );

      expect(result.success).toBe(true);
      expect(result.outcome).toBe("executed");
    });
  });

  // -------------------------------------------------------------------------
  // Audit trail
  // -------------------------------------------------------------------------

  describe("Audit trail", () => {
    it("successful action generates an audit record", async () => {
      await executeAction(
        "AddTicketNote",
        { ticketId: "abc12345", note: "Test note" },
        "Testing audit",
        "test-agent",
        ctx(),
      );

      expect(auditRecords).toHaveLength(1);
      expect(auditRecords[0].actionType).toBe("AddTicketNote");
      expect(auditRecords[0].agentId).toBe("test-agent");
      expect(auditRecords[0].reasoning).toBe("Testing audit");
      expect(auditRecords[0].outcome).toBe("executed");
    });

    it("staged action (ORANGE/RED tier) generates an audit record", async () => {
      // CancelOrder is RED tier → staged with audit
      await executeAction(
        "CancelOrder",
        {
          orderId: "order-001-uuid",
          reason: "Customer changed mind",
          cancellationOwner: "Customer",
        },
        "Customer requested cancellation",
        "test-agent",
        ctx(),
      );

      expect(auditRecords).toHaveLength(1);
      expect(auditRecords[0].outcome).toBe("staged");
      expect(auditRecords[0].actionType).toBe("CancelOrder");
      expect(auditRecords[0].reasoning).toBe("Customer requested cancellation");
    });
  });

  // -------------------------------------------------------------------------
  // Circuit breaker
  // -------------------------------------------------------------------------

  describe("Circuit breaker", () => {
    it("opens after repeated failures", async () => {
      // Cause 4 rapid failures by assigning to non-existent orders
      for (let i = 0; i < 4; i++) {
        await executeAction(
          "AssignDriverToOrder",
          { orderId: `fake-${i}`, driverId: "driver1@test.com" },
          "Triggering circuit breaker",
          "breaker-agent",
          { ...ctx(), state: store as any },
        );
      }

      // 5th attempt should be blocked by circuit breaker
      const result = await executeAction(
        "AddTicketNote",
        { ticketId: "abc12345", note: "Should be blocked" },
        "After circuit break",
        "breaker-agent",
        { ...ctx(), state: store as any },
      );

      expect(result.success).toBe(false);
      expect(result.outcome).toBe("circuit_broken");
    });
  });
});
