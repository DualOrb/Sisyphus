/**
 * Scenario: End-of-shift transition with mixed in-progress work.
 *
 * Setup: It's the end of the shift. The system has:
 *   - 3 in-progress orders at different stages (one nearly done, one mid-delivery, one barely started)
 *   - 1 open support ticket (missing items, investigation partially complete)
 *   - Market health declining (score rising)
 *   - 2 drivers online, 1 paused
 *
 * Tests whether Sisyphus can:
 *   - Identify which tasks can be completed quickly vs need handoff
 *   - Complete the simple tasks (close the nearly-done order's investigation)
 *   - Add handoff notes to complex tasks that can't be finished in time
 *   - Generate a shift summary with accurate stats
 *   - Flag unresolved items for the next shift
 *   - Not start new non-urgent work during shift-end
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
    // Order 1: Nearly complete — at customer's door, about to be delivered
    transformOrder({
      OrderId: "shift-order-001",
      OrderIdKey: "shift-01",
      OrderStatus: "AtCustomer",
      OrderType: "Delivery",
      UserId: "cust-shift-1@test.com",
      DriverId: "driver-shift-a@test.com",
      RestaurantId: "rest-shift-1",
      RestaurantName: "Quick Bites",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 2400,
      OrderPlacedTime: NOW - 2400,
      DriverAssignedTime: NOW - 2100,
      DeliveryConfirmedTime: NOW - 2000,
      OrderReadyTime: NOW - 1500,
      EnrouteTime: NOW - 2040,
      OrderInBagTime: NOW - 1440,
      OrderInTransitTime: NOW - 1380,
      AtCustomerTime: NOW - 120, // arrived 2 min ago
      OrderSubtotal: 1800,
      Tax: 234,
      OrderTotal: 2034,
      ASAP: true,
      Alcohol: false,
    }),

    // Order 2: Mid-delivery — driver is in transit, will take ~10 more min
    transformOrder({
      OrderId: "shift-order-002",
      OrderIdKey: "shift-02",
      OrderStatus: "InTransit",
      OrderType: "Delivery",
      UserId: "cust-shift-2@test.com",
      DriverId: "driver-shift-b@test.com",
      RestaurantId: "rest-shift-2",
      RestaurantName: "Pasta Place",
      DeliveryZone: "Pembroke",
      OrderCreatedTime: NOW - 1800,
      OrderPlacedTime: NOW - 1800,
      DriverAssignedTime: NOW - 1500,
      DeliveryConfirmedTime: NOW - 1400,
      OrderReadyTime: NOW - 900,
      EnrouteTime: NOW - 1440,
      OrderInBagTime: NOW - 840,
      OrderInTransitTime: NOW - 600, // in transit for 10 min
      OrderSubtotal: 2500,
      Tax: 325,
      OrderTotal: 3225,
      ASAP: true,
      Alcohol: false,
    }),

    // Order 3: Barely started — pending, no driver assigned, 8 min old
    transformOrder({
      OrderId: "shift-order-003",
      OrderIdKey: "shift-03",
      OrderStatus: "Pending",
      OrderType: "Delivery",
      UserId: "cust-shift-3@test.com",
      DriverId: null,
      RestaurantId: "rest-shift-1",
      RestaurantName: "Quick Bites",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 480,
      OrderPlacedTime: NOW - 480,
      OrderSubtotal: 1200,
      Tax: 156,
      OrderTotal: 1356,
      ASAP: true,
      Alcohol: false,
    }),
  ]);

  store.updateDrivers([
    transformDriver({
      DriverId: "driver-shift-a@test.com",
      FullName: "Alpha Amy",
      Phone: "(613) 555-8001",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-amy",
    }),
    transformDriver({
      DriverId: "driver-shift-b@test.com",
      FullName: "Bravo Ben",
      Phone: "(613) 555-8002",
      DispatchZone: "Pembroke",
      DeliveryArea: "Pembroke",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-ben",
    }),
    transformDriver({
      DriverId: "driver-shift-c@test.com",
      FullName: "Charlie Chilling",
      Phone: "(613) 555-8003",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: true, // paused — on break
      Active: true,
      ConnectionId: "conn-charlie",
    }),
  ]);

  // Market health is declining — Perth score rising
  store.updateMarkets([
    transformMarket({
      Market: "Perth",
      Score: 65,
      idealDrivers: 3,
      drivers: 1, // only 1 available (Amy), Charlie is paused
      activeOrders: 2,
      ts: NOW,
    }),
    transformMarket({
      Market: "Pembroke",
      Score: 45,
      idealDrivers: 2,
      drivers: 1,
      activeOrders: 1,
      ts: NOW,
    }),
  ]);

  store.updateRestaurants([
    transformRestaurant({
      RestaurantId: "rest-shift-1",
      RestaurantName: "Quick Bites",
      DeliveryZone: "Perth",
      Restaurant: true,
      DeliveryAvailable: true,
      LastHeartbeat: NOW - 15,
    }),
    transformRestaurant({
      RestaurantId: "rest-shift-2",
      RestaurantName: "Pasta Place",
      DeliveryZone: "Pembroke",
      Restaurant: true,
      DeliveryAvailable: true,
      LastHeartbeat: NOW - 25,
    }),
  ]);

  // Open ticket: missing items, investigation started but not resolved
  store.updateTickets([
    transformTicket({
      IssueId: "shift-tkt-001",
      Category: "Order Issue",
      IssueType: "Missing Items",
      IssueStatus: "Pending",
      Created: NOW - 1200,
      OrderId: "shift-order-002",
      OrderIdKey: "shift-02",
      RestaurantId: "rest-shift-2",
      RestaurantName: "Pasta Place",
      DriverId: "driver-shift-b@test.com",
      Market: "Pembroke",
      Originator: "cust-shift-2@test.com",
      Owner: "sisyphus@valleyeats.ca",
      Description:
        "My garlic bread was missing from the order. I paid for it but it wasn't in the bag.",
    }),
  ]);
}

export const shiftTransitionScenario: Scenario = {
  name: "Shift Transition — End of Shift Handoff",
  description:
    "End of shift: 3 in-progress orders (near-done, mid-delivery, barely started), " +
    "1 open ticket (missing items), market health declining. " +
    "Tests shift-end procedures: complete quick tasks, hand off complex ones, " +
    "generate handoff notes, flag unresolved items.",
  setup,
  actions: [
    // Task 1: The nearly-done order (shift-order-001) is at the customer's door.
    // This is a "completable within 5 minutes" task — just note it's finishing.
    {
      label: "Note: order shift-01 about to complete (at customer door)",
      name: "AddTicketNote",
      params: {
        ticketId: "shift-tkt-001", // Adding a general shift note
        note:
          "SHIFT STATUS: Order shift-01 is AtCustomer (driver Amy arrived 2 min ago). " +
          "Expected to complete within minutes — no handoff needed for this order.",
      },
      reasoning:
        "Order shift-01 is at the customer's door — will complete naturally. " +
        "No intervention needed, just noting the status for the shift record.",
      expectedOutcome: "executed",
    },

    // Task 2: The mid-delivery order (shift-order-002) is in transit.
    // This is in progress and will complete on its own, but note it for handoff.
    {
      label: "Handoff note: order shift-02 in transit (mid-delivery)",
      name: "AddTicketNote",
      params: {
        ticketId: "shift-tkt-001",
        note:
          "SHIFT HANDOFF: Order shift-02 is InTransit (driver Ben, Pasta Place → customer). " +
          "Been in transit 10 min. Should complete within next 10 min. " +
          "Associated ticket shift-tkt-001 (missing garlic bread) still open — see below.",
      },
      reasoning:
        "Order shift-02 is in transit and will likely complete during transition. " +
        "Documenting status so the next operator has context.",
      expectedOutcome: "executed",
    },

    // Task 3: The unassigned order (shift-order-003) needs attention.
    // This is a complex task — flag it for the next shift rather than starting new work.
    {
      label: "Flag unassigned order for next shift",
      name: "FlagMarketIssue",
      params: {
        market: "Perth",
        issueType: "unassigned_orders",
        severity: "high",
        details:
          "Order shift-03 (Quick Bites, Perth) has been Pending for 8 min with no driver. " +
          "Perth has only 1 available driver (Amy, currently on delivery). " +
          "Charlie is paused. SHIFT HANDOFF: Next operator should assign or escalate.",
      },
      reasoning:
        "Shift is ending — not starting a new assignment flow. " +
        "Flagging the unassigned order so the next shift operator addresses it immediately.",
      expectedOutcome: "executed",
    },

    // Task 4: Add handoff note to the open ticket (missing garlic bread).
    // Investigation started but not completed — document current state for next shift.
    {
      label: "Handoff note on open missing-items ticket",
      name: "AddTicketNote",
      params: {
        ticketId: "shift-tkt-001",
        note:
          "SHIFT HANDOFF: Missing items ticket (garlic bread). " +
          "Investigation started — customer reports garlic bread missing from Pasta Place order shift-02. " +
          "Order is still in transit (driver Ben). " +
          "REMAINING: Confirm item value from OrderItems, issue credit (~800 cents estimated), " +
          "send customer message, and resolve. Straightforward — ORANGE tier.",
      },
      reasoning:
        "Shift is ending and this ticket can't be fully resolved in the remaining time " +
        "(order is still in transit). Documenting investigation progress and remaining steps " +
        "so the next operator can complete it quickly.",
      expectedOutcome: "executed",
    },

    // Task 5: Flag declining market health for next shift
    {
      label: "Flag Perth market health for handoff",
      name: "FlagMarketIssue",
      params: {
        market: "Perth",
        issueType: "low_drivers",
        severity: "high",
        details:
          "SHIFT HANDOFF: Perth score 65 (WARNING level) and rising. " +
          "1 available driver, 1 paused (Charlie). idealDrivers: 3. " +
          "Next shift should monitor closely and consider asking Charlie to unpause.",
      },
      reasoning:
        "Perth market health is declining at shift end. Flagging for the next operator " +
        "with specific recommendation (check if Charlie can unpause).",
      expectedOutcome: "executed",
    },

    // Task 6: Log shift-end summary as a ticket note
    {
      label: "Log shift-end summary on open ticket",
      name: "AddTicketNote",
      params: {
        ticketId: "shift-tkt-001",
        note:
          "SHIFT END SUMMARY: Completable orders: 1 (shift-01 at customer). " +
          "In-progress: 1 (shift-02 in transit). Unassigned: 1 (shift-03, flagged). " +
          "Open tickets: 1 (this one). Markets at warning: Perth (score 65). " +
          "HANDOFF ITEMS: (1) Order shift-03 needs driver, (2) This ticket needs credit + resolve, (3) Perth needs monitoring.",
      },
      reasoning:
        "Logging shift-end summary with handoff items. 3 items flagged for next operator.",
      expectedOutcome: "executed",
    },

    // Task 7: Verify guardrails — should NOT start new non-urgent work during shift-end.
    // Attempting to assign a driver to the unassigned order should be rejected
    // because the shift-end process has been initiated and this is new work.
    {
      label: "New assignment during shift-end (should be deferred, not started)",
      name: "AssignDriverToOrder",
      params: {
        orderId: "shift-order-003",
        driverId: "driver-shift-c@test.com",
      },
      reasoning:
        "Testing that guardrails prevent assigning a paused driver during shift-end procedures.",
      expectedOutcome: "rejected",
    },
  ],
};
