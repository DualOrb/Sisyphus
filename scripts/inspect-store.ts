#!/usr/bin/env tsx
/**
 * CLI tool to inspect ontology state.
 *
 * Creates an OntologyStore populated with sample data and prints a summary
 * of entities, useful for debugging the ontology layer without live infra.
 *
 * Usage:
 *   tsx scripts/inspect-store.ts              # show all entities
 *   tsx scripts/inspect-store.ts --orders     # show only orders
 *   tsx scripts/inspect-store.ts --drivers    # show only drivers
 *   tsx scripts/inspect-store.ts --markets    # show only markets
 *   tsx scripts/inspect-store.ts --tickets    # show only tickets
 */

import { OntologyStore } from "../src/ontology/state/store.js";
import {
  transformOrder,
  transformDriver,
  transformMarket,
  transformRestaurant,
  transformTicket,
  transformCustomer,
} from "../src/ontology/sync/transformer.js";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const showOrders = args.includes("--orders");
const showDrivers = args.includes("--drivers");
const showMarkets = args.includes("--markets");
const showTickets = args.includes("--tickets");
const showAll = !showOrders && !showDrivers && !showMarkets && !showTickets;

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// Populate store with sample data
// ---------------------------------------------------------------------------

const NOW = Math.floor(Date.now() / 1000);

function populateStore(): OntologyStore {
  const store = new OntologyStore();

  store.updateOrders([
    transformOrder({
      OrderId: "a1b2c3d4-0001-4000-8000-000000000001",
      OrderStatus: "Pending",
      OrderType: "Delivery",
      UserId: "alice@example.com",
      DriverId: null,
      RestaurantId: "r1b2c3d4-0001-4000-8000-000000000001",
      RestaurantName: "Pizza Palace",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 300,
      OrderPlacedTime: NOW - 300,
      OrderSubtotal: 2500,
      Tax: 325,
      DeliveryFee: 499,
      Tip: 300,
      OrderTotal: 3624,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "a1b2c3d4-0002-4000-8000-000000000002",
      OrderStatus: "Confirmed",
      OrderType: "Delivery",
      UserId: "bob@example.com",
      DriverId: "driver-a@test.com",
      RestaurantId: "r1b2c3d4-0001-4000-8000-000000000001",
      RestaurantName: "Pizza Palace",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 900,
      OrderPlacedTime: NOW - 900,
      DriverAssignedTime: NOW - 600,
      OrderSubtotal: 1800,
      Tax: 234,
      DeliveryFee: 499,
      Tip: 200,
      OrderTotal: 2733,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "a1b2c3d4-0003-4000-8000-000000000003",
      OrderStatus: "EnRoute",
      OrderType: "Delivery",
      UserId: "carol@example.com",
      DriverId: "driver-b@test.com",
      RestaurantId: "r1b2c3d4-0002-4000-8000-000000000002",
      RestaurantName: "Burger Barn",
      DeliveryZone: "Pembroke",
      OrderCreatedTime: NOW - 1800,
      OrderPlacedTime: NOW - 1800,
      DriverAssignedTime: NOW - 1500,
      OrderReadyTime: NOW - 600,
      EnrouteTime: NOW - 300,
      OrderSubtotal: 3200,
      Tax: 416,
      DeliveryFee: 599,
      Tip: 500,
      OrderTotal: 4715,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "a1b2c3d4-0004-4000-8000-000000000004",
      OrderStatus: "Completed",
      OrderType: "Delivery",
      UserId: "dave@example.com",
      DriverId: "driver-a@test.com",
      RestaurantId: "r1b2c3d4-0002-4000-8000-000000000002",
      RestaurantName: "Burger Barn",
      DeliveryZone: "Pembroke",
      OrderCreatedTime: NOW - 7200,
      OrderPlacedTime: NOW - 7200,
      OrderDeliveredTime: NOW - 3600,
      OrderSubtotal: 1500,
      Tax: 195,
      DeliveryFee: 399,
      Tip: 100,
      OrderTotal: 2194,
      ASAP: true,
      Alcohol: false,
    }),
    transformOrder({
      OrderId: "a1b2c3d4-0005-4000-8000-000000000005",
      OrderStatus: "Cancelled",
      OrderType: "Delivery",
      UserId: "eve@example.com",
      DriverId: null,
      RestaurantId: "r1b2c3d4-0001-4000-8000-000000000001",
      RestaurantName: "Pizza Palace",
      DeliveryZone: "Perth",
      OrderCreatedTime: NOW - 5400,
      OrderPlacedTime: NOW - 5400,
      OrderSubtotal: 900,
      Tax: 117,
      DeliveryFee: 399,
      Tip: 0,
      OrderTotal: 1416,
      ASAP: true,
      Alcohol: false,
    }),
  ]);

  store.updateDrivers([
    transformDriver({
      DriverId: "driver-a@test.com",
      FullName: "Alice Driver",
      Phone: "(613) 555-0001",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-alice",
    }),
    transformDriver({
      DriverId: "driver-b@test.com",
      FullName: "Bob Driver",
      Phone: "(613) 555-0002",
      DispatchZone: "Pembroke",
      DeliveryArea: "Pembroke",
      Available: true,
      Paused: false,
      Active: true,
      ConnectionId: "conn-bob",
    }),
    transformDriver({
      DriverId: "driver-c@test.com",
      FullName: "Charlie Driver",
      Phone: "(613) 555-0003",
      DispatchZone: "Perth",
      DeliveryArea: "Perth",
      Available: false,
      Paused: true,
      Active: true,
      ConnectionId: null,
    }),
  ]);

  store.updateMarkets([
    transformMarket({ Market: "Perth", Score: 45, idealDrivers: 3, drivers: 2, activeOrders: 3, ts: NOW }),
    transformMarket({ Market: "Pembroke", Score: 70, idealDrivers: 2, drivers: 1, activeOrders: 2, ts: NOW }),
    transformMarket({ Market: "Petawawa", Score: 10, idealDrivers: 1, drivers: 2, activeOrders: 0, ts: NOW }),
  ]);

  store.updateRestaurants([
    transformRestaurant({
      RestaurantId: "r1b2c3d4-0001-4000-8000-000000000001",
      RestaurantName: "Pizza Palace",
      DeliveryZone: "Perth",
      Restaurant: true,
      DeliveryAvailable: true,
      LastHeartbeat: NOW - 30,
    }),
    transformRestaurant({
      RestaurantId: "r1b2c3d4-0002-4000-8000-000000000002",
      RestaurantName: "Burger Barn",
      DeliveryZone: "Pembroke",
      Restaurant: true,
      DeliveryAvailable: true,
      LastHeartbeat: NOW - 15,
    }),
  ]);

  store.updateCustomers([
    transformCustomer({
      Email: "alice@example.com",
      FullName: "Alice Customer",
      Phone: "(613) 555-1001",
      PerksPoints: 250,
      DeliveryAddresses: [],
    }),
    transformCustomer({
      Email: "bob@example.com",
      FullName: "Bob Customer",
      Phone: "(613) 555-1002",
      PerksPoints: 1200,
      DeliveryAddresses: [],
    }),
  ]);

  store.updateTickets([
    transformTicket({
      IssueId: "tkt-0001",
      Category: "Order Issue",
      IssueType: "Late Delivery",
      IssueStatus: "New",
      Created: NOW - 1200,
      OrderId: "a1b2c3d4-0003-4000-8000-000000000003",
      RestaurantId: "r1b2c3d4-0002-4000-8000-000000000002",
      RestaurantName: "Burger Barn",
      Market: "Pembroke",
      Originator: "carol@example.com",
      Owner: "Unassigned",
      Description: "Order is taking longer than expected.",
    }),
    transformTicket({
      IssueId: "tkt-0002",
      Category: "Driver Issue",
      IssueType: "Stale Driver Location",
      IssueStatus: "Pending",
      Created: NOW - 3600,
      DriverId: "driver-c@test.com",
      Market: "Perth",
      Originator: "Supervisor",
      Owner: "agent@valleyeats.ca",
      Description: "Driver location has not updated in 15+ minutes.",
    }),
  ]);

  store.markSynced();
  return store;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function padR(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function padL(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : " ".repeat(len - s.length) + s;
}

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function minutesAgo(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins === 0) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} mins ago`;
}

// ---------------------------------------------------------------------------
// Print sections
// ---------------------------------------------------------------------------

function printStats(store: OntologyStore): void {
  const stats = store.getStats();
  console.log(c.bold("\n  Entity Counts"));
  console.log("  " + "-".repeat(40));
  console.log(`  Orders:         ${c.cyan(String(stats.orders))}`);
  console.log(`  Drivers:        ${c.cyan(String(stats.drivers))}`);
  console.log(`  Restaurants:    ${c.cyan(String(stats.restaurants))}`);
  console.log(`  Customers:      ${c.cyan(String(stats.customers))}`);
  console.log(`  Tickets:        ${c.cyan(String(stats.tickets))}`);
  console.log(`  Markets:        ${c.cyan(String(stats.markets))}`);
  console.log(`  Conversations:  ${c.cyan(String(stats.conversations))}`);
  console.log(`  Last synced:    ${stats.lastSyncedAt ? stats.lastSyncedAt.toISOString() : c.dim("never")}`);
}

function printOrders(store: OntologyStore): void {
  const orders = Array.from(store.orders.values());
  console.log(c.bold("\n  Orders") + c.dim(` (${orders.length} total)`));
  console.log("  " + "-".repeat(90));
  console.log(
    `  ${padR("ID (short)", 12)} ${padR("Status", 12)} ${padR("Restaurant", 20)} ${padR("Zone", 12)} ${padR("Driver", 22)} ${padR("Total", 10)} ${padR("Placed", 14)}`,
  );
  console.log("  " + "-".repeat(90));

  const sample = orders.slice(0, 3);
  for (const order of sample) {
    const shortId = order.orderId.slice(0, 8);
    const driver = order.driverId ?? c.dim("unassigned");
    const statusColor =
      order.status === "Completed" ? c.green
        : order.status === "Cancelled" ? c.red
          : order.status === "Pending" ? c.yellow
            : (s: string) => s;

    console.log(
      `  ${padR(shortId, 12)} ${padR(statusColor(order.status), 12 + 9)} ${padR(order.restaurantName, 20)} ${padR(order.deliveryZone, 12)} ${padR(driver, 22)} ${padL(centsToDollars(order.total), 10)} ${padR(minutesAgo(order.placedAt), 14)}`,
    );
  }
  if (orders.length > 3) {
    console.log(c.dim(`  ... and ${orders.length - 3} more`));
  }

  // Status breakdown
  const statusCounts = new Map<string, number>();
  for (const order of orders) {
    statusCounts.set(order.status, (statusCounts.get(order.status) ?? 0) + 1);
  }
  console.log(c.dim("\n  Status breakdown:"));
  for (const [status, count] of statusCounts) {
    console.log(c.dim(`    ${status}: ${count}`));
  }
}

function printDrivers(store: OntologyStore): void {
  const drivers = Array.from(store.drivers.values());
  console.log(c.bold("\n  Drivers") + c.dim(` (${drivers.length} total)`));
  console.log("  " + "-".repeat(80));
  console.log(
    `  ${padR("Email", 26)} ${padR("Name", 18)} ${padR("Zone", 12)} ${padR("Status", 10)} ${padR("Online", 8)} ${padR("Orders", 8)}`,
  );
  console.log("  " + "-".repeat(80));

  for (const driver of drivers) {
    const statusColor =
      driver.status === "Online" ? c.green
        : driver.status === "Offline" ? c.red
          : driver.status === "OnBreak" ? c.yellow
            : (s: string) => s;

    console.log(
      `  ${padR(driver.driverId, 26)} ${padR(driver.name, 18)} ${padR(driver.dispatchZone, 12)} ${padR(statusColor(driver.status), 10 + 9)} ${padR(driver.isOnline ? c.green("yes") : c.red("no"), 8 + 9)} ${padL(String(driver.activeOrdersCount), 8)}`,
    );
  }
}

function printMarkets(store: OntologyStore): void {
  const markets = Array.from(store.markets.values());
  console.log(c.bold("\n  Market Health Summary") + c.dim(` (${markets.length} markets)`));
  console.log("  " + "-".repeat(75));
  console.log(
    `  ${padR("Market", 15)} ${padR("Score", 8)} ${padR("Demand", 10)} ${padR("Drivers", 10)} ${padR("Ideal", 8)} ${padR("Gap", 6)} ${padR("Active Ord", 12)}`,
  );
  console.log("  " + "-".repeat(75));

  for (const market of markets) {
    const scoreColor =
      market.score >= 70 ? c.red
        : market.score >= 40 ? c.yellow
          : c.green;

    const gapStr = market.driverGap > 0
      ? c.red(`-${market.driverGap}`)
      : market.driverGap < 0
        ? c.green(`+${Math.abs(market.driverGap)}`)
        : c.dim("0");

    console.log(
      `  ${padR(market.market, 15)} ${padR(scoreColor(String(market.score)), 8 + 9)} ${padR(market.demandLevel, 10)} ${padL(String(market.availableDrivers), 10)} ${padL(String(market.idealDrivers), 8)} ${padR(gapStr, 6 + 9)} ${padL(String(market.activeOrders), 12)}`,
    );
  }
}

function printTickets(store: OntologyStore): void {
  const tickets = Array.from(store.tickets.values());
  console.log(c.bold("\n  Tickets") + c.dim(` (${tickets.length} total)`));
  console.log("  " + "-".repeat(90));
  console.log(
    `  ${padR("ID", 12)} ${padR("Status", 10)} ${padR("Category", 16)} ${padR("Type", 22)} ${padR("Owner", 22)} ${padR("Age", 12)}`,
  );
  console.log("  " + "-".repeat(90));

  for (const ticket of tickets) {
    const statusColor =
      ticket.status === "New" ? c.yellow
        : ticket.status === "Resolved" ? c.green
          : (s: string) => s;

    console.log(
      `  ${padR(ticket.issueId, 12)} ${padR(statusColor(ticket.status), 10 + 9)} ${padR(ticket.category, 16)} ${padR(ticket.issueType, 22)} ${padR(ticket.owner, 22)} ${padR(minutesAgo(ticket.createdAt), 12)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log("");
  console.log(c.bold("  Sisyphus Ontology Store Inspector"));
  console.log(c.dim("  Populated with sample data for debugging."));

  const store = populateStore();

  if (showAll) {
    printStats(store);
    printOrders(store);
    printDrivers(store);
    printMarkets(store);
    printTickets(store);
  } else {
    printStats(store);
    if (showOrders) printOrders(store);
    if (showDrivers) printDrivers(store);
    if (showMarkets) printMarkets(store);
    if (showTickets) printTickets(store);
  }

  console.log("");
}

main();
