/**
 * Scenario: Normal operations — everything is fine.
 *
 * Setup: Balanced markets, orders flowing normally, drivers available.
 * Tests whether Sisyphus:
 *   - Correctly identifies routine situations
 *   - Does NOT over-act (no unnecessary escalations)
 *   - Routine monitoring actions execute cleanly
 *   - AddTicketNote works on an existing routine ticket
 *   - Assign works for a normal pending order
 *   - Invalid actions are still rejected (guardrails still work)
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
  store.updateOrders([
    transformOrder({
      OrderId: "happy-001",
      OrderStatus: "Pending",
      OrderType: "Delivery",
      UserId: "cust-happy-1@test.com",
      DriverId: null,
      RestaurantId: "rest-happy-1",
      RestaurantName: "Healthy Bowl",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 180, // only 3 min ago — fresh
      OrderPlacedTime: NOW - 180,
      OrderSubtotal: 1500,
      Tax: 195,
      OrderTotal: 1695,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "happy-002",
      OrderStatus: "Confirmed",
      OrderType: "Delivery",
      UserId: "cust-happy-2@test.com",
      DriverId: "driver-happy-a@test.com",
      RestaurantId: "rest-happy-1",
      RestaurantName: "Healthy Bowl",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 600,
      OrderPlacedTime: NOW - 600,
      DriverAssignedTime: NOW - 500,
      OrderSubtotal: 2200,
      Tax: 286,
      OrderTotal: 2486,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "happy-003",
      OrderStatus: "EnRoute",
      OrderType: "Delivery",
      UserId: "cust-happy-3@test.com",
      DriverId: "driver-happy-b@test.com",
      RestaurantId: "rest-happy-2",
      RestaurantName: "Sandwich Shop",
      DeliveryZone: "Pembroke",
      OrderCreatedTime: NOW - 1200,
      OrderPlacedTime: NOW - 1200,
      DriverAssignedTime: NOW - 1000,
      OrderReadyTime: NOW - 600,
      EnrouteTime: NOW - 300,
      OrderSubtotal: 1100,
      Tax: 143,
      OrderTotal: 1243,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "happy-004",
      OrderStatus: "Completed",
      OrderType: "Delivery",
      UserId: "cust-happy-4@test.com",
      DriverId: "driver-happy-a@test.com",
      RestaurantId: "rest-happy-2",
      RestaurantName: "Sandwich Shop",
      DeliveryZone: "Pembroke",
      OrderCreatedTime: NOW - 3600,
      OrderPlacedTime: NOW - 3600,
      OrderDeliveredTime: NOW - 1800,
      OrderSubtotal: 900,
      Tax: 117,
      OrderTotal: 1017,
      ASAP: true,
      Alcohol: false,
    }),
  ]);

  store.updateDrivers([
    transformDriver({
      DriverId: "driver-happy-a@test.com",
      FullName: "Happy Hank",
      Phone: "(613) 555-5001",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-hank",
    }),
    transformDriver({
      DriverId: "driver-happy-b@test.com",
      FullName: "Jolly Jane",
      Phone: "(613) 555-5002",
      DispatchZone: "Pembroke",
      DeliveryArea: "Pembroke",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-jane",
    }),
    transformDriver({
      DriverId: "driver-happy-c@test.com",
      FullName: "Calm Carlos",
      Phone: "(613) 555-5003",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-carlos",
    }),
  ]);

  store.updateMarkets([
    transformMarket({ Market: "Perth", Score: 30, idealDrivers: 2, drivers: 2, activeOrders: 2, ts: NOW }),
    transformMarket({ Market: "Pembroke", Score: 25, idealDrivers: 1, drivers: 1, activeOrders: 1, ts: NOW }),
  ]);

  store.updateRestaurants([
    transformRestaurant({
      RestaurantId: "rest-happy-1",
      RestaurantName: "Healthy Bowl",
      DeliveryZone: "Perth",
      Restaurant: true,
      DeliveryAvailable: true,
      LastHeartbeat: NOW - 10,
    }),
    transformRestaurant({
      RestaurantId: "rest-happy-2",
      RestaurantName: "Sandwich Shop",
      DeliveryZone: "Pembroke",
      Restaurant: true,
      DeliveryAvailable: true,
      LastHeartbeat: NOW - 20,
    }),
  ]);

  // One routine ticket — nothing urgent
  store.updateTickets([
    transformTicket({
      IssueId: "happy-tkt1",
      Category: "Order Issue",
      IssueType: "Other",
      IssueStatus: "Pending",
      Created: NOW - 7200,
      OrderId: "happy-004",
      RestaurantId: "rest-happy-2",
      RestaurantName: "Sandwich Shop",
      Market: "Pembroke",
      Originator: "cust-happy-4@test.com",
      Owner: "agent@valleyeats.ca",
      Description: "Small question about a previous order — not urgent.",
    }),
  ]);
}

export const happyPathScenario: Scenario = {
  name: "Happy Path — Normal Operations",
  description:
    "Balanced markets, orders flowing normally, plenty of drivers. " +
    "Tests that Sisyphus handles routine work correctly and does NOT over-act.",
  setup,
  actions: [
    {
      label: "Assign driver to fresh pending order",
      name: "AssignDriverToOrder",
      params: { orderId: "happy-001", driverId: "driver-happy-c@test.com" },
      reasoning: "Routine assignment — fresh order in Perth, Carlos is available and nearby.",
      expectedOutcome: "executed",
    },
    {
      label: "Add routine note to existing ticket",
      name: "AddTicketNote",
      params: {
        ticketId: "happy-tkt1",
        note: "Reviewed the order — no issues found. Customer had a general question about the menu. Routine follow-up.",
      },
      reasoning: "Routine ticket maintenance — documenting investigation.",
      expectedOutcome: "executed",
    },
    {
      label: "Message driver with pickup info",
      name: "SendDriverMessage",
      params: {
        driverId: "driver-happy-c@test.com",
        message: "Hi Carlos, you have a new order from Healthy Bowl. Please head to the restaurant for pickup when ready.",
        relatedOrderId: "happy-001",
      },
      reasoning: "Notifying newly assigned driver about the pickup location.",
      expectedOutcome: "executed",
    },
    {
      label: "Cannot assign to completed order (guardrails still enforce)",
      name: "AssignDriverToOrder",
      params: { orderId: "happy-004", driverId: "driver-happy-a@test.com" },
      reasoning: "Testing that guardrails reject assignment to a completed order even during happy path.",
      expectedOutcome: "rejected",
    },
    {
      label: "Unknown action name rejected",
      name: "DoSomethingMagical",
      params: {},
      reasoning: "Testing that unknown actions are rejected.",
      expectedOutcome: "rejected",
    },
  ],
};
