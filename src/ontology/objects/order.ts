/**
 * Order schema — maps to ValleyEats-Orders DynamoDB table.
 *
 * Key conventions:
 * - All monetary values are in CENTS (integers).
 * - All timestamps are Unix epoch SECONDS.
 * - OrderId is a UUID; OrderIdKey is its first 8 characters.
 * - UserId and DriverId are EMAIL ADDRESSES, not UUIDs.
 * - RestaurantId is a UUID.
 */

import { z } from "zod";
import { OrderStatus, OrderType, DeliveryType } from "./enums.js";
import { GeoPointSchema, MoneyInCentsSchema } from "./common.js";

// ---------------------------------------------------------------------------
// OrderItem — embedded in Order.OrderItems[]
// ---------------------------------------------------------------------------

export const OrderItemSchema = z.object({
  /** Menu item UUID */
  itemId: z.string().describe("DynamoDB: ItemId"),
  /** Human-readable item name */
  itemName: z.string().describe("DynamoDB: ItemName"),
  /** Price in cents */
  price: MoneyInCentsSchema.describe("DynamoDB: Price — cents"),
  /** Quantity ordered */
  quantity: z.number().int().min(1).describe("DynamoDB: Quantity"),
  /** Restaurant cuisine tag */
  cuisine: z.string().optional().describe("DynamoDB: Cuisine"),
  /** Modifier / option selections */
  menuOptions: z.record(z.unknown()).optional().describe("DynamoDB: MenuOptions"),
  /** Whether this item contains alcohol */
  alcohol: z.boolean().optional().describe("DynamoDB: Alcohol"),
  /** Whether this item is taxable */
  taxable: z.boolean().optional().describe("DynamoDB: Taxable"),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

export const OrderSchema = z.object({
  // ---- Identity ----
  /** Full UUID primary key */
  orderId: z.string().uuid().describe("DynamoDB PK: OrderId"),
  /** First 8 chars of UUID — human-friendly short code */
  orderIdKey: z.string().max(8).describe("DynamoDB: OrderIdKey"),

  // ---- Status & Type ----
  status: OrderStatus.describe("DynamoDB: OrderStatus"),
  orderType: OrderType.describe("DynamoDB: OrderType"),
  deliveryType: DeliveryType.optional().describe("DynamoDB: DeliveryType"),
  isAsap: z.boolean().describe("DynamoDB: ASAP"),

  // ---- Participants (FK references) ----
  /** Customer email — FK to ValleyEats-Users.Email */
  customerId: z.string().email().describe("DynamoDB: UserId — customer email"),
  /** Driver email — FK to ValleyEats-Drivers.DriverId. Null if unassigned. */
  driverId: z.string().email().nullable().describe("DynamoDB: DriverId — driver email"),
  /** Restaurant UUID — FK to ValleyEats-Restaurants.RestaurantId */
  restaurantId: z.string().uuid().describe("DynamoDB: RestaurantId"),
  /** Denormalized restaurant name */
  restaurantName: z.string().describe("DynamoDB: RestaurantName"),

  // ---- Delivery details ----
  deliveryZone: z.string().describe("DynamoDB: DeliveryZone — market name (e.g. 'Perth')"),
  deliveryStreet: z.string().optional().describe("DynamoDB: DeliveryStreet"),
  deliveryCity: z.string().optional().describe("DynamoDB: DeliveryCity"),
  deliveryProvince: z.string().optional().describe("DynamoDB: DeliveryProvince"),
  deliveryInstructions: z.string().nullable().optional().describe("DynamoDB: DeliveryInstructions"),
  deliveryDistance: z.number().int().optional().describe("DynamoDB: DeliveryDistance — meters"),

  // ---- Geo ----
  customerLocation: GeoPointSchema.nullable().optional().describe("DynamoDB: CustomerLocation"),
  orderLocation: GeoPointSchema.nullable().optional().describe("DynamoDB: OrderLocation — restaurant geo"),

  // ---- Financials (all CENTS) ----
  subtotal: MoneyInCentsSchema.describe("DynamoDB: OrderSubtotal — cents"),
  tax: MoneyInCentsSchema.describe("DynamoDB: Tax — cents"),
  deliveryFee: MoneyInCentsSchema.describe("DynamoDB: DeliveryFee — cents"),
  tip: MoneyInCentsSchema.describe("DynamoDB: Tip — cents"),
  total: MoneyInCentsSchema.describe("DynamoDB: OrderTotal — cents"),

  // ---- Flags ----
  hasAlcohol: z.boolean().describe("DynamoDB: Alcohol"),

  // ---- Items ----
  items: z.array(OrderItemSchema).describe("DynamoDB: OrderItems"),

  // ---- Lifecycle timestamps (Unix epoch SECONDS, nullable for optional stages) ----
  createdAt: z.coerce.date().describe("DynamoDB: OrderCreatedTime"),
  placedAt: z.coerce.date().describe("DynamoDB: OrderPlacedTime"),
  confirmedAt: z.coerce.date().nullable().optional().describe("DynamoDB: DeliveryConfirmedTime"),
  driverAssignedAt: z.coerce.date().nullable().optional().describe("DynamoDB: DriverAssignedTime"),
  readyAt: z.coerce.date().nullable().optional().describe("DynamoDB: OrderReadyTime"),
  inBagAt: z.coerce.date().nullable().optional().describe("DynamoDB: OrderInBagTime"),
  enrouteAt: z.coerce.date().nullable().optional().describe("DynamoDB: EnrouteTime"),
  inTransitAt: z.coerce.date().nullable().optional().describe("DynamoDB: OrderInTransitTime"),
  atCustomerAt: z.coerce.date().nullable().optional().describe("DynamoDB: AtCustomerTime"),
  deliveredAt: z.coerce.date().nullable().optional().describe("DynamoDB: OrderDeliveredTime"),

  // ---- Timing metrics (seconds) ----
  travelTime: z.number().optional().describe("DynamoDB: TravelTime — seconds"),
  enrouteDuration: z.number().optional().describe("DynamoDB: EnrouteDuration — seconds"),

  // ---- Computed properties (populated during ontology sync) ----
  /** Whether the order is past its expected delivery window */
  isLate: z.boolean().describe("Computed: ETA vs actual"),
  /** Minutes elapsed since the order was placed */
  waitTimeMinutes: z.number().describe("Computed: now - placedAt"),
  /** Minutes elapsed since the order was marked ready, or null if not ready */
  timeSinceReady: z.number().nullable().describe("Computed: now - readyAt"),
});

export type Order = z.infer<typeof OrderSchema>;
