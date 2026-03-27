/**
 * Dashboard API endpoint handlers.
 *
 * Each handler reads from the in-memory OntologyStore and returns JSON.
 * No mutations — the dashboard is read-only.
 */

import type { OntologyStore } from "../ontology/state/store.js";
import type { SystemHealth } from "../health/checks.js";
import type { ShiftStats } from "../shift/activities.js";
import type { PostgresDb } from "../memory/postgres/client.js";
import type { EventQueue } from "../events/queue.js";
import { getRecentAuditRecords } from "../memory/postgres/queries.js";
import { ApiRouter, json, notFound, serverError } from "./router.js";
import type { SseManager } from "./sse.js";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("api:handlers");

// ---------------------------------------------------------------------------
// Dependencies injected at creation time
// ---------------------------------------------------------------------------

export interface DashboardDeps {
  store: OntologyStore;
  getHealth: () => Promise<SystemHealth>;
  getShiftStats?: () => ShiftStats;
  getEventQueueSize?: () => number;
  db?: PostgresDb;
  sse: SseManager;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function createDashboardRoutes(deps: DashboardDeps): ApiRouter {
  const router = new ApiRouter();
  const { store, getHealth, getShiftStats, getEventQueueSize, db, sse } = deps;

  // ---- Overview -----------------------------------------------------------

  router.get("/api/overview", async (_req, res) => {
    try {
      const [stats, health] = await Promise.all([
        store.getStats(),
        getHealth(),
      ]);
      json(res, {
        stats,
        health,
        shift: getShiftStats?.(),
        eventQueueSize: getEventQueueSize?.() ?? 0,
        uptime: health.uptime,
      });
    } catch (err) {
      log.error({ err }, "Error serving /api/overview");
      serverError(res, "Failed to fetch overview");
    }
  });

  // ---- Orders -------------------------------------------------------------

  router.get("/api/orders", (_req, res, ctx) => {
    const status = ctx.query.get("status") ?? undefined;
    const zone = ctx.query.get("zone") ?? undefined;

    const orders = store.queryOrders({
      status,
      deliveryZone: zone,
    });

    // Strip items from list view to reduce payload
    const slim = orders.map(({ items: _items, ...rest }) => rest);
    json(res, slim);
  });

  router.get("/api/orders/:id", (_req, res, ctx) => {
    const order = store.getOrder(ctx.params.id);
    if (!order) return notFound(res);
    json(res, order);
  });

  // ---- Drivers ------------------------------------------------------------

  router.get("/api/drivers", (_req, res, ctx) => {
    const zone = ctx.query.get("zone") ?? undefined;
    const statusFilter = ctx.query.get("status") ?? undefined;

    let drivers = store.queryDrivers({
      dispatchZone: zone,
    });

    // Post-filter by computed status if requested
    if (statusFilter) {
      drivers = drivers.filter((d) => d.status === statusFilter);
    }

    json(res, drivers);
  });

  router.get("/api/drivers/:id", (_req, res, ctx) => {
    const driver = store.getDriver(ctx.params.id);
    if (!driver) return notFound(res);
    json(res, driver);
  });

  // ---- Restaurants --------------------------------------------------------

  router.get("/api/restaurants", (_req, res, ctx) => {
    const zone = ctx.query.get("zone") ?? undefined;
    const openParam = ctx.query.get("open");
    const isOpen = openParam === "true" ? true : openParam === "false" ? false : undefined;

    const restaurants = store.queryRestaurants({
      deliveryZone: zone,
      isOpen,
    });

    json(res, restaurants);
  });

  router.get("/api/restaurants/:id", (_req, res, ctx) => {
    const restaurant = store.getRestaurant(ctx.params.id);
    if (!restaurant) return notFound(res);
    json(res, restaurant);
  });

  // ---- Markets ------------------------------------------------------------

  router.get("/api/markets", (_req, res) => {
    const markets = Array.from(store.markets.values());
    // Sort by score descending (hottest first)
    markets.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    json(res, markets);
  });

  router.get("/api/markets/:name", (_req, res, ctx) => {
    const market = store.getMarket(ctx.params.name);
    if (!market) return notFound(res);
    json(res, market);
  });

  // ---- Tickets ------------------------------------------------------------

  router.get("/api/tickets", (_req, res, ctx) => {
    const status = ctx.query.get("status") ?? undefined;
    const tickets = store.queryTickets({ status });
    json(res, tickets);
  });

  router.get("/api/tickets/:id", (_req, res, ctx) => {
    const ticket = store.getTicket(ctx.params.id);
    if (!ticket) return notFound(res);
    json(res, ticket);
  });

  // ---- Conversations ------------------------------------------------------

  router.get("/api/conversations", (_req, res, ctx) => {
    const unreadParam = ctx.query.get("unread");
    const hasUnread = unreadParam === "true" ? true : undefined;
    const conversations = store.queryConversations({ hasUnread });
    json(res, conversations);
  });

  // ---- Audit log ----------------------------------------------------------

  router.get("/api/audit", async (_req, res, ctx) => {
    if (!db) {
      json(res, []);
      return;
    }
    try {
      const limitParam = ctx.query.get("limit");
      const limit = limitParam ? Math.min(parseInt(limitParam, 10), 500) : 200;
      const records = await getRecentAuditRecords(db, limit);
      json(res, records);
    } catch (err) {
      log.error({ err }, "Error fetching audit records");
      serverError(res, "Failed to fetch audit records");
    }
  });

  // ---- SSE stream ---------------------------------------------------------

  router.get("/api/events/stream", (req, res) => {
    sse.connect(req, res);
  });

  return router;
}
