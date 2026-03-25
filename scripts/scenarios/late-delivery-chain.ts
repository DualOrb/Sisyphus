/**
 * Scenario: Complex late delivery chain — full resolution flow.
 *
 * Uses only the 11 registered actions. Credits/messages to customers
 * are handled via ticket notes and the ResolveTicket action.
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
      OrderId: "late-chain-001",
      OrderIdKey: "late-001",
      OrderStatus: "Ready",
      OrderType: "Delivery",
      UserId: "cust-late@test.com",
      DriverId: "driver-late-a@test.com",
      RestaurantId: "rest-late-1",
      RestaurantName: "Slow Kitchen",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 2700,
      OrderPlacedTime: NOW - 2700,
      DeliveryConfirmedTime: NOW - 1500,
      DriverAssignedTime: NOW - 2400,
      OrderReadyTime: NOW - 300,
      OrderSubtotal: 3200,
      Tax: 416,
      DeliveryFee: 400,
      Tip: 500,
      OrderTotal: 4516,
      ASAP: true,
      Alcohol: false,
    }),
  ]);

  store.updateDrivers([
    transformDriver({
      DriverId: "driver-late-a@test.com",
      FullName: "Patient Pete",
      Phone: "(613) 555-7001",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-pete",
    }),
  ]);

  store.updateMarkets([
    transformMarket({ Market: "Perth", Score: 55, idealDrivers: 3, drivers: 2, ts: NOW }),
  ]);

  store.updateRestaurants([
    transformRestaurant({
      RestaurantId: "rest-late-1",
      RestaurantName: "Slow Kitchen",
      DeliveryZone: "Perth",
      Restaurant: true,
      DeliveryAvailable: true,
      LastHeartbeat: NOW - 30,
      POSETA: 20,
    }),
  ]);

  store.updateTickets([
    transformTicket({
      IssueId: "late-tkt-001",
      Category: "Order Issue",
      IssueType: "Late Delivery",
      IssueStatus: "New",
      Created: NOW - 600,
      OrderId: "late-chain-001",
      OrderIdKey: "late-001",
      RestaurantId: "rest-late-1",
      RestaurantName: "Slow Kitchen",
      DriverId: "driver-late-a@test.com",
      Market: "Perth",
      Originator: "cust-late@test.com",
      Owner: "Unassigned",
      Description: "I ordered 45 minutes ago and my food still hasn't arrived.",
    }),
  ]);
}

export const lateDeliveryChainScenario: Scenario = {
  name: "Late Delivery Chain — Full Resolution",
  description:
    "Order 45 min late due to restaurant delay (2x POSETA). Tests: investigate → document → resolve with refund → flag restaurant.",
  setup,
  actions: [
    {
      label: "Document investigation: restaurant delay identified",
      name: "AddTicketNote",
      params: {
        ticketId: "late-tkt-001",
        note: "INVESTIGATION: Order late-001 placed 45 min ago. Restaurant prep 40 min vs 20 min POSETA (2x). Driver was prompt. PRIMARY CAUSE: Restaurant delay.",
      },
      reasoning: "Analyzing lifecycle timestamps to identify delay cause.",
      expectedOutcome: "executed",
    },
    {
      label: "Flag restaurant health concern via second note",
      name: "AddTicketNote",
      params: {
        ticketId: "late-tkt-001",
        note: "RESTAURANT FLAG: Slow Kitchen (rest-late-1) exceeded POSETA by 100%. Flagging for health review.",
      },
      reasoning: "Restaurant exceeded its POSETA by 100% — quality indicator.",
      expectedOutcome: "executed",
    },
    {
      label: "Escalate ticket for customer compensation",
      name: "EscalateTicket",
      params: {
        ticketId: "late-tkt-001",
        reason: "Late delivery confirmed — restaurant fault. Customer needs credit of 1600 cents ($16). Escalating for compensation.",
        severity: "high",
      },
      reasoning: "Compensation requires escalation. 50% of subtotal = 1600 cents.",
      expectedOutcome: "executed",
    },
    {
      label: "Resolve ticket with refund (ORANGE tier — staged)",
      name: "ResolveTicket",
      params: {
        ticketId: "late-tkt-001",
        resolution: "Late delivery — restaurant delay. 40 min prep vs 20 min POSETA. Credit of 1600 cents issued.",
        resolutionType: "credit",
        refundAmount: 1600,
      },
      reasoning: "Investigation complete, customer compensated, restaurant flagged.",
      expectedOutcome: "staged", // ORANGE tier
    },
    {
      label: "Message driver about the situation",
      name: "SendDriverMessage",
      params: {
        driverId: "driver-late-a@test.com",
        message: "Hi Pete, thanks for your patience at Slow Kitchen. The customer has been notified about the delay.",
        relatedOrderId: "late-chain-001",
      },
      reasoning: "Acknowledging driver's wait time and keeping them informed.",
      expectedOutcome: "executed",
    },
    {
      label: "Second message to same driver blocked by cooldown",
      name: "SendDriverMessage",
      params: {
        driverId: "driver-late-a@test.com",
        message: "Just checking in again.",
      },
      reasoning: "Testing cooldown enforcement.",
      expectedOutcome: "cooldown_blocked",
    },
  ],
};
