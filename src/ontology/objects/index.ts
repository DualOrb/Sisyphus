/**
 * Barrel export for all ontology object schemas and inferred types.
 *
 * Usage:
 *   import { OrderSchema, type Order, OrderStatus } from "@ontology/objects/index.js";
 */

// ---- Enums ----
export {
  OrderStatus,
  OrderType,
  DeliveryType,
  DriverStatus,
  AppPermissionLevel,
  IssueStatus,
  IssueCategory,
  IssueType,
  Severity,
  Priority,
  Tier,
  DemandLevel,
  AlertLevel,
} from "./enums.js";

// ---- Common / shared sub-schemas ----
export {
  GeoPointSchema,
  type GeoPoint,
  TimeRangeSchema,
  type TimeRange,
  MoneyInCentsSchema,
  type MoneyInCents,
  MinutesFromMidnightSchema,
  type MinutesFromMidnight,
  centsToDollars,
  minutesToTimeString,
} from "./common.js";

// ---- Order ----
export {
  OrderItemSchema,
  type OrderItem,
  OrderSchema,
  type Order,
} from "./order.js";

// ---- Driver ----
export {
  AppSettingsSchema,
  type AppSettings,
  DriverSchema,
  type Driver,
} from "./driver.js";

// ---- Restaurant ----
export {
  DayHoursSchema,
  type DayHours,
  KitchenHoursSchema,
  type KitchenHours,
  RestaurantSchema,
  type Restaurant,
} from "./restaurant.js";

// ---- Customer ----
export {
  DeliveryAddressSchema,
  type DeliveryAddress,
  InAppMessageSchema,
  type InAppMessage,
  CustomerSchema,
  type Customer,
} from "./customer.js";

// ---- Ticket ----
export {
  TicketActionSchema,
  type TicketAction,
  TicketMessageSchema,
  type TicketMessage,
  TicketNoteSchema,
  type TicketNote,
  TicketSchema,
  type Ticket,
} from "./ticket.js";

// ---- Market ----
export {
  DemandPredictionSchema,
  type DemandPrediction,
  DemandPredictionMetadataSchema,
  type DemandPredictionMetadata,
  MarketSchema,
  type Market,
} from "./market.js";

// ---- Conversation & Message ----
export {
  MessageSchema,
  type Message,
  ConversationSchema,
  type Conversation,
} from "./conversation.js";
