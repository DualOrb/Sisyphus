/**
 * In-memory ontology state store.
 *
 * Holds typed Maps of each object type, populated by the sync layer.
 * Agents query the store — they never touch raw API data directly.
 */

import type {
  Order,
  Driver,
  Restaurant,
  Customer,
  Ticket,
  Market,
  Conversation,
} from "../objects/index.js";

// ---------------------------------------------------------------------------
// Query filter types
// ---------------------------------------------------------------------------

export interface OrderFilter {
  status?: string;
  deliveryZone?: string;
  driverId?: string;
}

export interface DriverFilter {
  dispatchZone?: string;
  isAvailable?: boolean;
  isOnline?: boolean;
}

export interface TicketFilter {
  status?: string;
  market?: string;
  owner?: string;
}

export interface RestaurantFilter {
  deliveryZone?: string;
  isActive?: boolean;
  isOpen?: boolean;
}

export interface ConversationFilter {
  hasUnread?: boolean;
}

// ---------------------------------------------------------------------------
// Store stats (returned by getStats)
// ---------------------------------------------------------------------------

export interface OntologyStats {
  orders: number;
  drivers: number;
  restaurants: number;
  customers: number;
  tickets: number;
  markets: number;
  conversations: number;
  lastSyncedAt: Date | null;
}

// ---------------------------------------------------------------------------
// OntologyStore
// ---------------------------------------------------------------------------

export class OntologyStore {
  readonly orders = new Map<string, Order>();
  readonly ordersByKey = new Map<string, Order>(); // OrderIdKey (8 chars) → Order
  readonly drivers = new Map<string, Driver>();
  readonly restaurants = new Map<string, Restaurant>();
  readonly restaurantsByKey = new Map<string, Restaurant>(); // RestaurantIdKey (8 chars) → Restaurant
  readonly customers = new Map<string, Customer>();
  readonly tickets = new Map<string, Ticket>();
  readonly markets = new Map<string, Market>();
  readonly conversations = new Map<string, Conversation>();

  private _lastSyncedAt: Date | null = null;

  // ---- Single-entity getters ------------------------------------------------

  /** Get order by full UUID OR 8-char OrderIdKey */
  getOrder(id: string): Order | undefined {
    return this.orders.get(id) ?? this.ordersByKey.get(id);
  }

  getDriver(id: string): Driver | undefined {
    return this.drivers.get(id);
  }

  /** Get restaurant by full UUID OR 8-char RestaurantIdKey */
  getRestaurant(id: string): Restaurant | undefined {
    return this.restaurants.get(id) ?? this.restaurantsByKey.get(id);
  }


  getCustomer(email: string): Customer | undefined {
    return this.customers.get(email);
  }

  getTicket(id: string): Ticket | undefined {
    return this.tickets.get(id);
  }

  getMarket(name: string): Market | undefined {
    return this.markets.get(name);
  }

  getConversation(driverId: string): Conversation | undefined {
    return this.conversations.get(driverId);
  }

  // ---- Filtered queries -----------------------------------------------------

  queryOrders(filter: OrderFilter): Order[] {
    const results: Order[] = [];
    for (const order of this.orders.values()) {
      if (filter.status !== undefined && order.status !== filter.status) continue;
      if (filter.deliveryZone !== undefined && order.deliveryZone !== filter.deliveryZone) continue;
      if (filter.driverId !== undefined && order.driverId !== filter.driverId) continue;
      results.push(order);
    }
    return results;
  }

  queryDrivers(filter: DriverFilter): Driver[] {
    const results: Driver[] = [];
    for (const driver of this.drivers.values()) {
      if (filter.dispatchZone !== undefined && driver.dispatchZone !== filter.dispatchZone) continue;
      if (filter.isAvailable !== undefined && driver.isAvailable !== filter.isAvailable) continue;
      if (filter.isOnline !== undefined && driver.isOnline !== filter.isOnline) continue;
      results.push(driver);
    }
    return results;
  }

  queryTickets(filter: TicketFilter): Ticket[] {
    const results: Ticket[] = [];
    for (const ticket of this.tickets.values()) {
      if (filter.status !== undefined && ticket.status !== filter.status) continue;
      if (filter.market !== undefined && ticket.market !== filter.market) continue;
      if (filter.owner !== undefined && ticket.owner !== filter.owner) continue;
      results.push(ticket);
    }
    return results;
  }

  queryRestaurants(filter: RestaurantFilter): Restaurant[] {
    const results: Restaurant[] = [];
    for (const restaurant of this.restaurants.values()) {
      if (filter.deliveryZone !== undefined && restaurant.deliveryZone !== filter.deliveryZone) continue;
      if (filter.isActive !== undefined && restaurant.isActive !== filter.isActive) continue;
      if (filter.isOpen !== undefined && restaurant.isOpen !== filter.isOpen) continue;
      results.push(restaurant);
    }
    return results;
  }

  queryConversations(filter: ConversationFilter): Conversation[] {
    const results: Conversation[] = [];
    for (const conversation of this.conversations.values()) {
      if (filter.hasUnread !== undefined && conversation.hasUnread !== filter.hasUnread) continue;
      results.push(conversation);
    }
    return results;
  }

  // ---- Bulk update (used by sync — replaces full map contents) --------------

  updateOrders(orders: Order[]): void {
    this.orders.clear();
    this.ordersByKey.clear();
    for (const order of orders) {
      this.orders.set(order.orderId, order);
      if (order.orderIdKey) {
        this.ordersByKey.set(order.orderIdKey, order);
      }
    }
  }

  updateDrivers(drivers: Driver[]): void {
    this.drivers.clear();
    for (const driver of drivers) {
      this.drivers.set(driver.driverId, driver);
    }
  }

  updateRestaurants(restaurants: Restaurant[]): void {
    this.restaurants.clear();
    this.restaurantsByKey.clear();
    for (const restaurant of restaurants) {
      this.restaurants.set(restaurant.restaurantId, restaurant);
      if (restaurant.restaurantIdKey) {
        this.restaurantsByKey.set(restaurant.restaurantIdKey, restaurant);
      }
    }
  }

  updateCustomers(customers: Customer[]): void {
    this.customers.clear();
    for (const customer of customers) {
      this.customers.set(customer.email, customer);
    }
  }

  updateTickets(tickets: Ticket[]): void {
    this.tickets.clear();
    for (const ticket of tickets) {
      this.tickets.set(ticket.issueId, ticket);
    }
  }

  updateMarkets(markets: Market[]): void {
    this.markets.clear();
    for (const market of markets) {
      this.markets.set(market.market, market);
    }
  }

  updateConversations(conversations: Conversation[]): void {
    this.conversations.clear();
    for (const conversation of conversations) {
      this.conversations.set(conversation.driverId, conversation);
    }
  }

  // ---- Metadata -------------------------------------------------------------

  markSynced(): void {
    this._lastSyncedAt = new Date();
  }

  get lastSyncedAt(): Date | null {
    return this._lastSyncedAt;
  }

  getStats(): OntologyStats {
    return {
      orders: this.orders.size,
      drivers: this.drivers.size,
      restaurants: this.restaurants.size,
      customers: this.customers.size,
      tickets: this.tickets.size,
      markets: this.markets.size,
      conversations: this.conversations.size,
      lastSyncedAt: this._lastSyncedAt,
    };
  }
}
