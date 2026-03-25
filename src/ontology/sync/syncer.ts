/**
 * Ontology sync orchestrator.
 *
 * Fetches data from the dispatch REST API, transforms it into typed ontology
 * objects, and populates the in-memory OntologyStore. Runs on a configurable
 * polling interval (default 30 seconds).
 *
 * Resilient: if one fetch fails, the others still complete. The sync loop
 * never crashes — errors are logged and the next cycle runs normally.
 */

import type { Logger } from "../../lib/logger.js";
import type { DispatchApiClient } from "./dispatch-api.js";
import type { OntologyStore } from "../state/store.js";
import type { OntologySyncSource } from "../../adapters/types.js";

import {
  transformOrder,
  transformDriver,
  transformRestaurant,
  transformTicket,
  transformMarket,
  transformConversation,
} from "./transformer.js";

// ---------------------------------------------------------------------------
// OntologySyncer
// ---------------------------------------------------------------------------

export class OntologySyncer {
  private readonly api: DispatchApiClient;
  private readonly store: OntologyStore;
  private readonly log: Logger;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private _isSyncing = false;

  /**
   * Optional adapter-based data source. When set, the syncer uses this
   * instead of the `DispatchApiClient` for fetching data — enabling it
   * to work with either the old or new dispatch system transparently.
   */
  private adapterSource: OntologySyncSource | null = null;

  constructor(api: DispatchApiClient, store: OntologyStore, logger: Logger) {
    this.api = api;
    this.store = store;
    this.log = logger;
  }

  /**
   * Create a syncer that uses a `DispatchAdapter` (or any `OntologySyncSource`)
   * instead of the direct `DispatchApiClient`.
   *
   * This factory method allows the syncer to work with the adapter layer
   * without breaking any existing code that passes a `DispatchApiClient`.
   */
  static fromAdapter(
    adapter: OntologySyncSource,
    store: OntologyStore,
    logger: Logger,
  ): OntologySyncer {
    // We need a DispatchApiClient for the constructor, but the adapter
    // will override all fetch calls. Create a dummy client that the
    // adapterSource will shadow.
    const dummyApi = {
      fetchOrders: () => Promise.resolve([]),
      fetchDrivers: () => Promise.resolve([]),
      fetchIssues: () => Promise.resolve([]),
      fetchConversations: () => Promise.resolve([]),
      fetchDispatchSnapshot: () => Promise.resolve(null),
      fetchMarketMeters: () => Promise.resolve([]),
    } as unknown as DispatchApiClient;

    const syncer = new OntologySyncer(dummyApi, store, logger);
    syncer.adapterSource = adapter;
    logger.info("OntologySyncer created with adapter source");
    return syncer;
  }

  // ---- Public API -----------------------------------------------------------

  /** Whether a sync cycle is currently in progress. */
  get isSyncing(): boolean {
    return this._isSyncing;
  }

  /**
   * Execute a single sync cycle.
   *
   * 1. Fetch all entity types from the dispatch API in parallel.
   * 2. Transform raw responses into typed ontology objects.
   * 3. Replace store contents with the new data.
   * 4. Enrich computed cross-entity fields (driver order counts, restaurant load).
   * 5. Log stats.
   */
  async sync(): Promise<void> {
    if (this._isSyncing) {
      this.log.debug("Sync already in progress, skipping this cycle");
      return;
    }

    this._isSyncing = true;
    const startMs = Date.now();

    try {
      // Parallel fetch — each wrapped in its own error boundary.
      // When an adapterSource is set (via `fromAdapter`), use it instead of
      // the direct DispatchApiClient. This lets the syncer work with any
      // dispatch backend through the adapter layer.
      const src = this.adapterSource;
      const [
        rawOrders,
        rawDrivers,
        rawIssues,
        rawConversations,
        rawSnapshot,
        rawMeters,
      ] = await Promise.all([
        this.safeFetch("orders", () =>
          src ? src.fetchOrders() : this.api.fetchOrders(),
        ),
        this.safeFetch("drivers", () =>
          src ? src.fetchDrivers() : this.api.fetchDrivers(),
        ),
        this.safeFetch("issues", () =>
          src ? src.fetchIssues() : this.api.fetchIssues(),
        ),
        this.safeFetch("conversations", () =>
          src?.fetchConversations
            ? src.fetchConversations()
            : this.api.fetchConversations(),
        ),
        this.safeFetch("snapshot", () =>
          src?.fetchDispatchSnapshot
            ? src.fetchDispatchSnapshot()
            : this.api.fetchDispatchSnapshot(),
        ),
        this.safeFetch("meters", () =>
          src?.fetchMarketMeters
            ? src.fetchMarketMeters()
            : this.api.fetchMarketMeters(),
        ),
      ]);

      // -- Transform orders --
      const orders = (rawOrders ?? []).map((raw: any) => {
        try { return transformOrder(raw); }
        catch (err) {
          this.log.warn({ err, orderId: raw?.OrderId }, "Failed to transform order");
          return null;
        }
      }).filter(Boolean) as ReturnType<typeof transformOrder>[];

      // -- Transform drivers --
      const drivers = (rawDrivers ?? []).map((raw: any) => {
        try { return transformDriver(raw); }
        catch (err) {
          this.log.warn({ err, driverId: raw?.DriverId }, "Failed to transform driver");
          return null;
        }
      }).filter(Boolean) as ReturnType<typeof transformDriver>[];

      // -- Transform tickets --
      const tickets = (rawIssues ?? []).map((raw: any) => {
        try { return transformTicket(raw); }
        catch (err) {
          this.log.warn({ err, issueId: raw?.IssueId }, "Failed to transform ticket");
          return null;
        }
      }).filter(Boolean) as ReturnType<typeof transformTicket>[];

      // -- Transform conversations --
      const conversations = (rawConversations ?? []).map((raw: any) => {
        try { return transformConversation(raw); }
        catch (err) {
          this.log.warn({ err, driverId: raw?.DriverId }, "Failed to transform conversation");
          return null;
        }
      }).filter(Boolean) as ReturnType<typeof transformConversation>[];

      // -- Transform markets from meters data --
      const markets = (rawMeters ?? []).map((raw: any) => {
        try { return transformMarket(raw); }
        catch (err) {
          this.log.warn({ err, market: raw?.Market }, "Failed to transform market");
          return null;
        }
      }).filter(Boolean) as ReturnType<typeof transformMarket>[];

      // -- Extract restaurants from snapshot if available --
      const rawRestaurants = this.extractRestaurants(rawSnapshot);
      const restaurants = rawRestaurants.map((raw: any) => {
        try { return transformRestaurant(raw); }
        catch (err) {
          this.log.warn({ err, restaurantId: raw?.RestaurantId }, "Failed to transform restaurant");
          return null;
        }
      }).filter(Boolean) as ReturnType<typeof transformRestaurant>[];

      // -- Update store --
      this.store.updateOrders(orders);
      this.store.updateDrivers(drivers);
      this.store.updateTickets(tickets);
      this.store.updateConversations(conversations);
      this.store.updateMarkets(markets);
      if (restaurants.length > 0) {
        this.store.updateRestaurants(restaurants);
      }

      // -- Enrich cross-entity computed fields --
      this.enrichDriverOrderCounts();
      this.enrichRestaurantLoad();
      this.enrichMarketActiveOrders();

      this.store.markSynced();

      const durationMs = Date.now() - startMs;
      const stats = this.store.getStats();
      this.log.info(
        {
          durationMs,
          orders: stats.orders,
          drivers: stats.drivers,
          restaurants: stats.restaurants,
          tickets: stats.tickets,
          markets: stats.markets,
          conversations: stats.conversations,
        },
        `Ontology sync completed in ${durationMs}ms`,
      );
    } catch (err) {
      const durationMs = Date.now() - startMs;
      this.log.error(
        { err, durationMs },
        `Ontology sync failed after ${durationMs}ms`,
      );
    } finally {
      this._isSyncing = false;
    }
  }

  /**
   * Start polling the dispatch API at the given interval.
   * Runs an initial sync immediately, then repeats.
   */
  startPolling(intervalMs = 30_000): void {
    if (this.intervalHandle != null) {
      this.log.warn("Polling already started — call stopPolling() first");
      return;
    }

    this.log.info({ intervalMs }, "Starting ontology sync polling");

    // Fire initial sync (don't await — let the interval start immediately)
    this.sync().catch((err) => {
      this.log.error({ err }, "Initial ontology sync failed");
    });

    this.intervalHandle = setInterval(() => {
      this.sync().catch((err) => {
        this.log.error({ err }, "Ontology sync cycle failed");
      });
    }, intervalMs);
  }

  /** Stop the polling loop. */
  stopPolling(): void {
    if (this.intervalHandle != null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.log.info("Ontology sync polling stopped");
    }
  }

  // ---- Private helpers ------------------------------------------------------

  /**
   * Wrapper that catches individual fetch errors so one failure
   * doesn't prevent the rest from completing.
   */
  private async safeFetch<T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      this.log.error({ err, label }, `Failed to fetch ${label}`);
      return null;
    }
  }

  /**
   * Extract restaurant records from the dispatch snapshot.
   * The snapshot structure may vary — attempt common shapes.
   */
  private extractRestaurants(snapshot: any): any[] {
    if (snapshot == null) return [];

    // Direct array
    if (Array.isArray(snapshot)) return snapshot;

    // Nested under a key
    if (Array.isArray(snapshot?.restaurants)) return snapshot.restaurants;
    if (Array.isArray(snapshot?.Restaurants)) return snapshot.Restaurants;

    // Per-market snapshot: { "Perth": { restaurants: [...] }, ... }
    if (typeof snapshot === "object") {
      const allRestaurants: any[] = [];
      for (const marketData of Object.values(snapshot)) {
        if (
          marketData &&
          typeof marketData === "object" &&
          Array.isArray((marketData as any).restaurants)
        ) {
          allRestaurants.push(...(marketData as any).restaurants);
        } else if (
          marketData &&
          typeof marketData === "object" &&
          Array.isArray((marketData as any).Restaurants)
        ) {
          allRestaurants.push(...(marketData as any).Restaurants);
        }
      }
      if (allRestaurants.length > 0) return allRestaurants;
    }

    return [];
  }

  /**
   * Enrich each driver with the count of their active orders.
   * Iterates orders and tallies by driverId.
   */
  private enrichDriverOrderCounts(): void {
    const counts = new Map<string, number>();

    for (const order of this.store.orders.values()) {
      if (
        order.driverId &&
        order.status !== "Completed" &&
        order.status !== "Cancelled"
      ) {
        counts.set(order.driverId, (counts.get(order.driverId) ?? 0) + 1);
      }
    }

    for (const driver of this.store.drivers.values()) {
      const count = counts.get(driver.driverId) ?? 0;
      // Mutate in place — the driver object is already in the Map
      (driver as any).activeOrdersCount = count;

      // Upgrade status to "Busy" if driver is online but at capacity (3+ orders)
      if (driver.status === "Online" && count >= 3) {
        (driver as any).status = "Busy";
      }
    }
  }

  /**
   * Enrich each restaurant with the count of active orders (currentLoad).
   */
  private enrichRestaurantLoad(): void {
    const counts = new Map<string, number>();

    for (const order of this.store.orders.values()) {
      if (order.status !== "Completed" && order.status !== "Cancelled") {
        counts.set(
          order.restaurantId,
          (counts.get(order.restaurantId) ?? 0) + 1,
        );
      }
    }

    for (const restaurant of this.store.restaurants.values()) {
      (restaurant as any).currentLoad = counts.get(restaurant.restaurantId) ?? 0;
    }
  }

  /**
   * Enrich each market with the count of active orders in its zone
   * and the driver-to-order ratio.
   */
  private enrichMarketActiveOrders(): void {
    const counts = new Map<string, number>();

    for (const order of this.store.orders.values()) {
      if (order.status !== "Completed" && order.status !== "Cancelled") {
        counts.set(
          order.deliveryZone,
          (counts.get(order.deliveryZone) ?? 0) + 1,
        );
      }
    }

    for (const market of this.store.markets.values()) {
      const activeOrders = counts.get(market.market) ?? 0;
      (market as any).activeOrders = activeOrders;
      (market as any).driverToOrderRatio =
        activeOrders > 0 ? market.availableDrivers / activeOrders : null;
    }
  }
}
