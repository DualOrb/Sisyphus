/**
 * Scenario: Order volume spikes in one market.
 *
 * Setup: 1 market ("PortElgin") with 10 active orders and only 2 drivers (score > 80).
 *        Another market ("Perth") is healthy and balanced.
 * Tests whether Sisyphus:
 *   - Detects the struggling market and flags it
 *   - Flags the specific issue type (high_demand and low_drivers)
 *   - Does NOT flag the healthy market unnecessarily
 *   - Can assign drivers in the healthy market without issues
 */

import {
  transformOrder,
  transformDriver,
  transformMarket,
  transformRestaurant,
} from "../../src/ontology/sync/transformer.js";
import type { OntologyStore } from "../../src/ontology/state/store.js";
import type { Scenario } from "./index.js";

const NOW = Math.floor(Date.now() / 1000);

function setup(store: OntologyStore): void {
  // 10 active orders in PortElgin, 2 in Perth
  const portElginOrders = Array.from({ length: 10 }, (_, i) =>
    transformOrder({
      OrderId: `surge-pe-${String(i + 1).padStart(3, "0")}`,
      OrderStatus: i < 3 ? "Pending" : i < 6 ? "Confirmed" : "Ready",
      OrderType: "Delivery",
      UserId: `cust-pe-${i + 1}@test.com`,
      DriverId: i >= 3 && i < 8 ? `driver-surge-a@test.com` : (i >= 8 ? `driver-surge-b@test.com` : null),
      RestaurantId: "rest-pe-1",
      RestaurantName: "Lakeside Grill",
      DeliveryZone: "PortElgin",
      OrderCreatedTime: NOW - (600 + i * 300),
      OrderPlacedTime: NOW - (600 + i * 300),
      OrderSubtotal: 2000 + i * 100,
      Tax: 260 + i * 13,
      OrderTotal: 2260 + i * 113,
      ASAP: true,
      Alcohol: false,
    }),
  );

  const perthOrders = [
    transformOrder({
      OrderId: "surge-perth-001",
      OrderStatus: "Pending",
      OrderType: "Delivery",
      UserId: "cust-perth-1@test.com",
      DriverId: null,
      RestaurantId: "rest-perth-1",
      RestaurantName: "Pizza Palace",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 300,
      OrderPlacedTime: NOW - 300,
      OrderSubtotal: 2200,
      Tax: 286,
      OrderTotal: 2486,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "surge-perth-002",
      OrderStatus: "Confirmed",
      OrderType: "Delivery",
      UserId: "cust-perth-2@test.com",
      DriverId: "driver-perth-a@test.com",
      RestaurantId: "rest-perth-1",
      RestaurantName: "Pizza Palace",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 900,
      OrderPlacedTime: NOW - 900,
      DriverAssignedTime: NOW - 800,
      OrderSubtotal: 1800,
      Tax: 234,
      OrderTotal: 2034,
      ASAP: true,
      Alcohol: false,
    }),
  ];

  store.updateOrders([...portElginOrders, ...perthOrders]);

  // PortElgin: 2 drivers only (overwhelmed)
  // Perth: 3 drivers (healthy)
  store.updateDrivers([
    transformDriver({
      DriverId: "driver-surge-a@test.com",
      FullName: "Andy Overworked",
      Phone: "(613) 555-4001",
      DispatchZone: "PortElgin",
      DeliveryArea: "PortElgin",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-andy",
    }),
    transformDriver({
      DriverId: "driver-surge-b@test.com",
      FullName: "Beth Busy",
      Phone: "(613) 555-4002",
      DispatchZone: "PortElgin",
      DeliveryArea: "PortElgin",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-beth",
    }),
    transformDriver({
      DriverId: "driver-perth-a@test.com",
      FullName: "Carla Calm",
      Phone: "(613) 555-4003",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-carla",
    }),
    transformDriver({
      DriverId: "driver-perth-b@test.com",
      FullName: "Dan Dependable",
      Phone: "(613) 555-4004",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-dan",
    }),
    transformDriver({
      DriverId: "driver-perth-c@test.com",
      FullName: "Eve Easy",
      Phone: "(613) 555-4005",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-eve",
    }),
  ]);

  // PortElgin is surging; Perth is healthy
  store.updateMarkets([
    transformMarket({
      Market: "PortElgin",
      Score: 92,
      idealDrivers: 6,
      drivers: 2,
      activeOrders: 10,
      ts: NOW,
    }),
    transformMarket({
      Market: "Perth",
      Score: 35,
      idealDrivers: 3,
      drivers: 3,
      activeOrders: 2,
      ts: NOW,
    }),
  ]);

  store.updateRestaurants([
    transformRestaurant({
      RestaurantId: "rest-pe-1",
      RestaurantName: "Lakeside Grill",
      DeliveryZone: "PortElgin",
      Restaurant: true,
      DeliveryAvailable: true,
      LastHeartbeat: NOW - 15,
    }),
    transformRestaurant({
      RestaurantId: "rest-perth-1",
      RestaurantName: "Pizza Palace",
      DeliveryZone: "Perth",
      Restaurant: true,
      DeliveryAvailable: true,
      LastHeartbeat: NOW - 30,
    }),
  ]);

  store.updateTickets([]);
}

export const marketSurgeScenario: Scenario = {
  name: "Market Surge — PortElgin Overwhelmed",
  description:
    "PortElgin has 10 active orders with only 2 drivers (score 92). " +
    "Perth is balanced with 3 drivers for 2 orders. " +
    "Tests market health detection and appropriate flagging.",
  setup,
  actions: [
    {
      label: "Flag PortElgin high demand",
      name: "FlagMarketIssue",
      params: {
        market: "PortElgin",
        issueType: "high_demand",
        severity: "critical",
        details: "10 active orders with only 2 drivers. Score 92 (Surge). Driver-to-order ratio 0.2.",
      },
      reasoning: "PortElgin market is in Surge with a massive driver gap of 4. Immediate attention needed.",
      expectedOutcome: "executed",
    },
    {
      label: "Flag PortElgin low drivers",
      name: "FlagMarketIssue",
      params: {
        market: "PortElgin",
        issueType: "low_drivers",
        severity: "high",
        details: "Need 6 drivers, only 2 available. Consider pulling from adjacent Perth market.",
      },
      reasoning: "Separate flag for driver shortage so ops can recruit or rebalance.",
      expectedOutcome: "executed",
    },
    {
      label: "Assign available Perth driver to Perth order (healthy market)",
      name: "AssignDriverToOrder",
      params: { orderId: "surge-perth-001", driverId: "driver-perth-b@test.com" },
      reasoning: "Perth has capacity — assigning Dan to the pending Perth order.",
      expectedOutcome: "executed",
    },
    {
      label: "Flag non-existent market rejected",
      name: "FlagMarketIssue",
      params: {
        market: "Atlantis",
        issueType: "low_drivers",
        severity: "medium",
        details: "Testing that flagging a non-existent market fails.",
      },
      reasoning: "Verifying guardrails catch unknown markets.",
      expectedOutcome: "rejected",
    },
    {
      label: "Assign PortElgin driver to one of the pending PortElgin orders",
      name: "AssignDriverToOrder",
      params: { orderId: "surge-pe-001", driverId: "driver-surge-a@test.com" },
      reasoning: "Assigning Andy to the oldest pending PortElgin order to start clearing the backlog.",
      expectedOutcome: "executed",
    },
  ],
};
