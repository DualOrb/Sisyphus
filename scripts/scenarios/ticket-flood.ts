/**
 * Scenario: Multiple support tickets arrive at once.
 *
 * Setup: 5 New tickets of varying severity:
 *   - Late delivery (order-level)
 *   - Missing items (order-level)
 *   - Wrong order (order-level)
 *   - Driver complaint (driver-level)
 *   - Cancel request (order-level, RED tier)
 *
 * Tests whether Sisyphus:
 *   - Triages by priority, adding notes to track investigation
 *   - Escalates complex or high-severity issues
 *   - Stages resolution with refund (ORANGE tier)
 *   - Correctly routes a cancel request through RED tier (staged)
 *   - Does not get overwhelmed by volume
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
      OrderId: "tkt-order-001",
      OrderStatus: "EnRoute",
      OrderType: "Delivery",
      UserId: "cust-tk1@test.com",
      DriverId: "driver-tk1@test.com",
      RestaurantId: "rest-tk-1",
      RestaurantName: "Wings Place",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 3600, // 60 min ago — very late
      OrderPlacedTime: NOW - 3600,
      OrderReadyTime: NOW - 2400,
      OrderSubtotal: 2500,
      Tax: 325,
      OrderTotal: 3225,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "tkt-order-002",
      OrderStatus: "Completed",
      OrderType: "Delivery",
      UserId: "cust-tk2@test.com",
      DriverId: "driver-tk1@test.com",
      RestaurantId: "rest-tk-1",
      RestaurantName: "Wings Place",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 7200,
      OrderPlacedTime: NOW - 7200,
      OrderDeliveredTime: NOW - 3600,
      OrderSubtotal: 1800,
      Tax: 234,
      OrderTotal: 2034,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "tkt-order-003",
      OrderStatus: "Completed",
      OrderType: "Delivery",
      UserId: "cust-tk3@test.com",
      DriverId: "driver-tk2@test.com",
      RestaurantId: "rest-tk-2",
      RestaurantName: "Noodle Bar",
      DeliveryZone: "Pembroke",
      OrderCreatedTime: NOW - 5400,
      OrderPlacedTime: NOW - 5400,
      OrderDeliveredTime: NOW - 1800,
      OrderSubtotal: 2200,
      Tax: 286,
      OrderTotal: 2486,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "tkt-order-004",
      OrderStatus: "Pending",
      OrderType: "Delivery",
      UserId: "cust-tk4@test.com",
      DriverId: null,
      RestaurantId: "rest-tk-1",
      RestaurantName: "Wings Place",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 300,
      OrderPlacedTime: NOW - 300,
      OrderSubtotal: 1600,
      Tax: 208,
      OrderTotal: 1808,
      ASAP: true,
      Alcohol: false,
    }),
  ]);

  store.updateDrivers([
    transformDriver({
      DriverId: "driver-tk1@test.com",
      FullName: "Diana Delivery",
      Phone: "(613) 555-3001",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-diana",
    }),
    transformDriver({
      DriverId: "driver-tk2@test.com",
      FullName: "Eddie Express",
      Phone: "(613) 555-3002",
      DispatchZone: "Pembroke",
      DeliveryArea: "Pembroke",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-eddie",
    }),
  ]);

  // 5 tickets — varying severity
  store.updateTickets([
    transformTicket({
      IssueId: "tkt-late-01",
      Category: "Order Issue",
      IssueType: "Late Delivery",
      IssueStatus: "New",
      Created: NOW - 120,
      OrderId: "tkt-order-001",
      RestaurantId: "rest-tk-1",
      RestaurantName: "Wings Place",
      DriverId: "driver-tk1@test.com",
      Market: "Perth",
      Originator: "cust-tk1@test.com",
      Owner: "Unassigned",
      Description: "My order has been on the way for over an hour. Where is my food?",
    }),
    transformTicket({
      IssueId: "tkt-miss-02",
      Category: "Order Issue",
      IssueType: "Missing Items",
      IssueStatus: "New",
      Created: NOW - 90,
      OrderId: "tkt-order-002",
      RestaurantId: "rest-tk-1",
      RestaurantName: "Wings Place",
      DriverId: "driver-tk1@test.com",
      Market: "Perth",
      Originator: "cust-tk2@test.com",
      Owner: "Unassigned",
      Description: "I ordered 10 wings and only got 6. Missing the fries too.",
    }),
    transformTicket({
      IssueId: "tkt-wrng-03",
      Category: "Order Issue",
      IssueType: "Wrong Order",
      IssueStatus: "New",
      Created: NOW - 60,
      OrderId: "tkt-order-003",
      RestaurantId: "rest-tk-2",
      RestaurantName: "Noodle Bar",
      DriverId: "driver-tk2@test.com",
      Market: "Pembroke",
      Originator: "cust-tk3@test.com",
      Owner: "Unassigned",
      Description: "Got someone else's order entirely. Wrong bag.",
    }),
    transformTicket({
      IssueId: "tkt-drvr-04",
      Category: "Driver Issue",
      IssueType: "Driver Complaint",
      IssueStatus: "New",
      Created: NOW - 45,
      DriverId: "driver-tk2@test.com",
      Market: "Pembroke",
      Originator: "cust-tk3@test.com",
      Owner: "Unassigned",
      Description: "Driver was rude and left the food on the ground in the rain.",
    }),
    transformTicket({
      IssueId: "tkt-canc-05",
      Category: "Order Issue",
      IssueType: "Cancel Order",
      IssueStatus: "New",
      Created: NOW - 30,
      OrderId: "tkt-order-004",
      RestaurantId: "rest-tk-1",
      RestaurantName: "Wings Place",
      Market: "Perth",
      Originator: "cust-tk4@test.com",
      Owner: "Unassigned",
      Description: "Changed my mind, please cancel the order.",
    }),
  ]);

  store.updateMarkets([
    transformMarket({ Market: "Perth", Score: 55, idealDrivers: 3, drivers: 1, activeOrders: 2, ts: NOW }),
    transformMarket({ Market: "Pembroke", Score: 40, idealDrivers: 2, drivers: 1, activeOrders: 1, ts: NOW }),
  ]);

  store.updateRestaurants([
    transformRestaurant({
      RestaurantId: "rest-tk-1",
      RestaurantName: "Wings Place",
      DeliveryZone: "Perth",
      Restaurant: true,
      DeliveryAvailable: true,
      LastHeartbeat: NOW - 45,
    }),
    transformRestaurant({
      RestaurantId: "rest-tk-2",
      RestaurantName: "Noodle Bar",
      DeliveryZone: "Pembroke",
      Restaurant: true,
      DeliveryAvailable: true,
      LastHeartbeat: NOW - 90,
    }),
  ]);
}

export const ticketFloodScenario: Scenario = {
  name: "Ticket Flood — Multiple Simultaneous Issues",
  description:
    "5 New tickets arrive at once: late delivery, missing items, wrong order, driver complaint, " +
    "and a cancel request. Tests triage prioritization and correct tier routing.",
  setup,
  actions: [
    // Triage: add notes to begin investigation on each
    {
      label: "Note on late delivery ticket (highest urgency)",
      name: "AddTicketNote",
      params: {
        ticketId: "tkt-late-01",
        note: "Order tkt-order-001 has been EnRoute for 60+ min. Driver Diana is online. Investigating delay.",
      },
      reasoning: "Late delivery is time-sensitive — noting investigation start.",
      expectedOutcome: "executed",
    },
    {
      label: "Escalate wrong order ticket (complex issue)",
      name: "EscalateTicket",
      params: {
        ticketId: "tkt-wrng-03",
        reason: "Customer received entirely wrong order — needs redelivery or full refund. Requires supervisor decision.",
        severity: "high",
      },
      reasoning: "Wrong order is a complex issue that likely needs a redelivery — escalating.",
      expectedOutcome: "executed",
    },
    {
      label: "Escalate driver complaint (needs human review)",
      name: "EscalateTicket",
      params: {
        ticketId: "tkt-drvr-04",
        reason: "Customer reports rude driver behavior and improper food handling. Needs HR/ops review.",
        severity: "high",
      },
      reasoning: "Driver behavior complaints require human judgment — escalating to ops.",
      expectedOutcome: "executed",
    },
    {
      label: "Resolve missing items with partial refund (ORANGE — staged)",
      name: "ResolveTicket",
      params: {
        ticketId: "tkt-miss-02",
        resolution: "Issuing partial refund for missing wings (4) and fries.",
        resolutionType: "refund",
        refundAmount: 1200,
      },
      reasoning: "Clear case of missing items — restaurant at fault. Partial refund is appropriate.",
      expectedOutcome: "staged",
    },
    {
      label: "Cancel order via RED tier (staged for human approval)",
      name: "CancelOrder",
      params: {
        orderId: "tkt-order-004",
        reason: "Customer requested cancellation. Order is still Pending — no food prepared yet.",
        cancellationOwner: "Customer",
      },
      reasoning: "Customer wants to cancel a Pending order. Straightforward but RED tier requires approval.",
      expectedOutcome: "staged",
    },
    {
      label: "Note on late delivery: follow up with driver",
      name: "AddTicketNote",
      params: {
        ticketId: "tkt-late-01",
        note: "Contacted driver Diana — she confirms she is stuck in traffic. ETA ~15 min. Monitoring.",
      },
      reasoning: "Updating ticket with driver status after investigation.",
      expectedOutcome: "executed",
    },
  ],
};
