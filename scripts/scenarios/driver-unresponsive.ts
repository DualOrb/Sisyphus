/**
 * Scenario: Driver goes silent mid-delivery.
 *
 * Setup: 1 Confirmed order with an assigned driver who has no recent heartbeat.
 *        2 other available drivers in the same zone.
 * Tests whether Sisyphus follows the no-response protocol:
 *   - Follow up with the silent driver
 *   - Cooldown blocks rapid follow-ups
 *   - Reassign the order to a responsive driver
 *   - Message the new driver about the pickup
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
  // 1 Confirmed order assigned to the silent driver
  store.updateOrders([
    transformOrder({
      OrderId: "silent-order-001",
      OrderStatus: "Confirmed",
      OrderType: "Delivery",
      UserId: "cust-silent@test.com",
      DriverId: "driver-silent@test.com",
      RestaurantId: "rest-silent-1",
      RestaurantName: "Curry House",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 1800,
      OrderPlacedTime: NOW - 1800,
      DriverAssignedTime: NOW - 1500, // assigned 25 min ago
      OrderSubtotal: 2800,
      Tax: 364,
      OrderTotal: 3564,
      ASAP: true,
      Alcohol: false,
    }),
  ]);

  // Silent driver (Available but no ConnectionId — went offline)
  // plus 2 healthy backup drivers
  store.updateDrivers([
    transformDriver({
      DriverId: "driver-silent@test.com",
      FullName: "Ghost McDriver",
      Phone: "(613) 555-2001",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: null, // lost connection — offline
    }),
    transformDriver({
      DriverId: "driver-backup-a@test.com",
      FullName: "Reliable Rita",
      Phone: "(613) 555-2002",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-rita",
    }),
    transformDriver({
      DriverId: "driver-backup-b@test.com",
      FullName: "Steady Steve",
      Phone: "(613) 555-2003",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-steve",
    }),
  ]);

  store.updateMarkets([
    transformMarket({ Market: "Perth", Score: 50, idealDrivers: 3, drivers: 2, activeOrders: 1, ts: NOW }),
  ]);

  store.updateRestaurants([
    transformRestaurant({
      RestaurantId: "rest-silent-1",
      RestaurantName: "Curry House",
      DeliveryZone: "Perth",
      Restaurant: true,
      DeliveryAvailable: true,
      LastHeartbeat: NOW - 20,
    }),
  ]);

  store.updateTickets([]);
}

export const driverUnresponsiveScenario: Scenario = {
  name: "Driver Unresponsive Mid-Delivery",
  description:
    "1 Confirmed order with a driver who dropped offline. 2 backup drivers available. " +
    "Tests the no-response protocol: follow up, then reassign.",
  setup,
  actions: [
    {
      label: "Follow up with silent driver",
      name: "FollowUpWithDriver",
      params: {
        driverId: "driver-silent@test.com",
        originalContext: "Driver assigned to order silent-order-001, confirmed 25 min ago, driver dropped offline.",
        followUpMessage: "Hi Ghost, we noticed you may have lost connection. Are you still able to complete order silent-order-001? Please respond ASAP.",
      },
      reasoning: "Driver has no ConnectionId — last heartbeat unknown. Following up before reassigning.",
      expectedOutcome: "executed",
    },
    {
      label: "Second follow-up blocked by cooldown",
      name: "FollowUpWithDriver",
      params: {
        driverId: "driver-silent@test.com",
        originalContext: "Still no response from driver.",
        followUpMessage: "Ghost, this is urgent. Please respond or the order will be reassigned.",
      },
      reasoning: "Quick second follow-up should be throttled by the 10-min cooldown.",
      expectedOutcome: "cooldown_blocked",
    },
    {
      label: "Reassign order to backup driver",
      name: "ReassignOrder",
      params: {
        orderId: "silent-order-001",
        newDriverId: "driver-backup-a@test.com",
        reason: "Original driver (Ghost McDriver) is unresponsive — no connection for 25+ min.",
      },
      reasoning: "No response after follow-up. Reassigning to Reliable Rita who is online and in Perth.",
      expectedOutcome: "executed",
    },
    {
      label: "Reassign cooldown blocks second reassignment",
      name: "ReassignOrder",
      params: {
        orderId: "silent-order-001",
        newDriverId: "driver-backup-b@test.com",
        reason: "Changed mind about reassignment.",
      },
      reasoning: "Immediate re-reassign should be blocked by the 10-min cooldown.",
      expectedOutcome: "cooldown_blocked",
    },
    {
      label: "Message the new driver about pickup",
      name: "SendDriverMessage",
      params: {
        driverId: "driver-backup-a@test.com",
        message: "Hi Rita, you have been assigned order silent-order-001 from Curry House. The food should be ready — please head to the restaurant for pickup.",
        relatedOrderId: "silent-order-001",
      },
      reasoning: "Notifying the new driver about the reassigned order so she can head to pickup.",
      expectedOutcome: "executed",
    },
  ],
};
