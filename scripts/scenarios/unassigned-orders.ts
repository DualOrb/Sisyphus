/**
 * Scenario: Orders piling up without drivers.
 *
 * Setup: 5 Pending orders across 2 markets, only 1 available driver, 2 markets.
 * Tests whether Sisyphus can prioritize correctly when resources are scarce:
 *   - Assign the single available driver to the highest-priority order
 *   - Flag understaffed markets
 *   - Escalate remaining unassigned orders
 *   - Cooldown blocks a second assign to the same order
 */

import {
  transformOrder,
  transformDriver,
  transformMarket,
  transformRestaurant,
  transformTicket,
} from "../../src/ontology/sync/transformer.js";
import type { OntologyStore } from "../../src/ontology/state/store.js";
import type { Scenario } from "./index.js";

const NOW = Math.floor(Date.now() / 1000);

function setup(store: OntologyStore): void {
  // 5 Pending orders spread across 2 zones
  store.updateOrders([
    transformOrder({
      OrderId: "unassign-001",
      OrderStatus: "Pending",
      OrderType: "Delivery",
      UserId: "cust-a@test.com",
      DriverId: null,
      RestaurantId: "rest-ua-1",
      RestaurantName: "Taco Town",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 2400, // 40 min ago — approaching late
      OrderPlacedTime: NOW - 2400,
      OrderSubtotal: 2200,
      Tax: 286,
      OrderTotal: 2886,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "unassign-002",
      OrderStatus: "Pending",
      OrderType: "Delivery",
      UserId: "cust-b@test.com",
      DriverId: null,
      RestaurantId: "rest-ua-1",
      RestaurantName: "Taco Town",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 600,
      OrderPlacedTime: NOW - 600,
      OrderSubtotal: 1500,
      Tax: 195,
      OrderTotal: 1695,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "unassign-003",
      OrderStatus: "Pending",
      OrderType: "Delivery",
      UserId: "cust-c@test.com",
      DriverId: null,
      RestaurantId: "rest-ua-2",
      RestaurantName: "Sushi Spot",
      DeliveryZone: "Pembroke",
      OrderCreatedTime: NOW - 1800, // 30 min ago
      OrderPlacedTime: NOW - 1800,
      OrderSubtotal: 3000,
      Tax: 390,
      OrderTotal: 3390,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "unassign-004",
      OrderStatus: "Pending",
      OrderType: "Delivery",
      UserId: "cust-d@test.com",
      DriverId: null,
      RestaurantId: "rest-ua-2",
      RestaurantName: "Sushi Spot",
      DeliveryZone: "Pembroke",
      OrderCreatedTime: NOW - 300,
      OrderPlacedTime: NOW - 300,
      OrderSubtotal: 1200,
      Tax: 156,
      OrderTotal: 1356,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "unassign-005",
      OrderStatus: "Pending",
      OrderType: "Delivery",
      UserId: "cust-e@test.com",
      DriverId: null,
      RestaurantId: "rest-ua-1",
      RestaurantName: "Taco Town",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 900,
      OrderPlacedTime: NOW - 900,
      OrderSubtotal: 1800,
      Tax: 234,
      OrderTotal: 2034,
      ASAP: true,
      Alcohol: false,
    }),
  ]);

  // 1 available driver (Perth), 1 paused, 1 offline
  store.updateDrivers([
    transformDriver({
      DriverId: "driver-avail@test.com",
      FullName: "Sam Available",
      Phone: "(613) 555-1001",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-avail",
    }),
    transformDriver({
      DriverId: "driver-paused@test.com",
      FullName: "Pat Paused",
      Phone: "(613) 555-1002",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: true,
      Active: true,
      ConnectionId: "conn-paused",
    }),
    transformDriver({
      DriverId: "driver-offline@test.com",
      FullName: "Ollie Offline",
      Phone: "(613) 555-1003",
      DispatchZone: "Pembroke",
      DeliveryArea: "Pembroke",
      Available: false,
      Paused: false,
      Active: true,
      ConnectionId: null,
    }),
  ]);

  // 2 markets — both understaffed
  store.updateMarkets([
    transformMarket({ Market: "Perth", Score: 80, idealDrivers: 4, drivers: 1, activeOrders: 3, ts: NOW }),
    transformMarket({ Market: "Pembroke", Score: 90, idealDrivers: 3, drivers: 0, activeOrders: 2, ts: NOW }),
  ]);

  store.updateRestaurants([
    transformRestaurant({
      RestaurantId: "rest-ua-1",
      RestaurantName: "Taco Town",
      DeliveryZone: "Perth",
      Restaurant: true,
      DeliveryAvailable: true,
      LastHeartbeat: NOW - 30,
    }),
    transformRestaurant({
      RestaurantId: "rest-ua-2",
      RestaurantName: "Sushi Spot",
      DeliveryZone: "Pembroke",
      Restaurant: true,
      DeliveryAvailable: true,
      LastHeartbeat: NOW - 60,
    }),
  ]);

  // No tickets in this scenario
  store.updateTickets([]);
}

export const unassignedOrdersScenario: Scenario = {
  name: "Unassigned Orders Piling Up",
  description:
    "5 Pending orders, only 1 available driver, 2 understaffed markets. " +
    "Tests prioritization under resource scarcity.",
  setup,
  actions: [
    {
      label: "Assign sole driver to oldest Perth order",
      name: "AssignDriverToOrder",
      params: { orderId: "unassign-001", driverId: "driver-avail@test.com" },
      reasoning: "Order unassign-001 is the oldest (40 min) and in the same zone as the available driver.",
      expectedOutcome: "executed",
    },
    {
      label: "Assign attempt blocked by cooldown (same order)",
      name: "AssignDriverToOrder",
      params: { orderId: "unassign-001", driverId: "driver-avail@test.com" },
      reasoning: "Re-assigning same order immediately should be blocked.",
      expectedOutcome: "cooldown_blocked",
    },
    {
      label: "Assign paused driver rejected",
      name: "AssignDriverToOrder",
      params: { orderId: "unassign-002", driverId: "driver-paused@test.com" },
      reasoning: "Attempting to use a paused driver — should fail criteria.",
      expectedOutcome: "rejected",
    },
    {
      label: "Assign offline driver rejected",
      name: "AssignDriverToOrder",
      params: { orderId: "unassign-003", driverId: "driver-offline@test.com" },
      reasoning: "Attempting to use an offline driver — should fail criteria.",
      expectedOutcome: "rejected",
    },
    {
      label: "Flag Perth as understaffed",
      name: "FlagMarketIssue",
      params: {
        market: "Perth",
        issueType: "low_drivers",
        severity: "high",
        details: "3 pending orders, only 1 driver available in Perth.",
      },
      reasoning: "Perth market is severely understaffed with a surge score of 80.",
      expectedOutcome: "executed",
    },
    {
      label: "Flag Pembroke as understaffed",
      name: "FlagMarketIssue",
      params: {
        market: "Pembroke",
        issueType: "low_drivers",
        severity: "critical",
        details: "2 pending orders with zero drivers in Pembroke.",
      },
      reasoning: "Pembroke has no available drivers at all — critical understaffing.",
      expectedOutcome: "executed",
    },
  ],
};
