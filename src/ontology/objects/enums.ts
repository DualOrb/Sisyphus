/**
 * Shared enums for the Sisyphus ontology layer.
 *
 * Values are grounded in real DynamoDB data discovered in
 * ValleyEats production tables (see planning/10-data-model-discovery.md).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Order enums
// ---------------------------------------------------------------------------

/** Values observed in ValleyEats-Orders.OrderStatus */
export const OrderStatus = z.enum([
  "Pending",
  "Confirmed",
  "Ready",
  "EnRoute",
  "InTransit",
  "Completed",
  "Cancelled",
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

/** Values observed in ValleyEats-Orders.OrderType */
export const OrderType = z.enum(["Delivery", "Takeout"]);
export type OrderType = z.infer<typeof OrderType>;

/** Values observed in ValleyEats-Orders.DeliveryType */
export const DeliveryType = z.enum(["Leave at door", "Hand delivered"]);
export type DeliveryType = z.infer<typeof DeliveryType>;

// ---------------------------------------------------------------------------
// Driver enums
// ---------------------------------------------------------------------------

/**
 * Logical driver status derived from the combination of
 * Available / Paused / Active / ConnectionId fields.
 * Not stored directly in DynamoDB — computed at sync time.
 */
export const DriverStatus = z.enum([
  "Online",    // Available && !Paused && ConnectionId != null
  "Busy",      // Available but at max concurrent orders
  "Offline",   // !Available || ConnectionId == null
  "OnBreak",   // Paused
  "Inactive",  // !Active (employment ended)
]);
export type DriverStatus = z.infer<typeof DriverStatus>;

/**
 * App permission level reported by the driver's device.
 * Observed in ValleyEats-Drivers.AppSetting fields.
 */
export const AppPermissionLevel = z.enum(["Full", "Partial", "No"]);
export type AppPermissionLevel = z.infer<typeof AppPermissionLevel>;

// ---------------------------------------------------------------------------
// Issue / Ticket enums
// ---------------------------------------------------------------------------

/** Values observed in ValleyEats-IssueTracker.IssueStatus */
export const IssueStatus = z.enum(["New", "Pending", "Resolved", "Closed"]);
export type IssueStatus = z.infer<typeof IssueStatus>;

/** Values observed in ValleyEats-IssueTracker.Category */
export const IssueCategory = z.enum(["Order Issue", "Driver Issue"]);
export type IssueCategory = z.infer<typeof IssueCategory>;

/**
 * Common issue types observed across IssueTracker records.
 * Not an exhaustive enum — new types can appear — so we allow
 * any string but provide known values for autocomplete.
 */
export const IssueType = z.string().describe(
  'Known values: "Other", "Cancel Order", "Stale Driver Location", etc.',
);
export type IssueType = z.infer<typeof IssueType>;

// ---------------------------------------------------------------------------
// Severity / Priority / Tier (used across actions and AI metrics)
// ---------------------------------------------------------------------------

/** Severity levels observed in AIMetrics shadow actions */
export const Severity = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof Severity>;

/** Priority levels observed in AIMetrics shadow actions */
export const Priority = z.enum(["normal", "high", "urgent", "critical"]);
export type Priority = z.infer<typeof Priority>;

/** Autonomy tiers for action execution (from ontology design doc) */
export const Tier = z.enum(["GREEN", "YELLOW", "ORANGE", "RED"]);
export type Tier = z.infer<typeof Tier>;

// ---------------------------------------------------------------------------
// Market / Zone enums
// ---------------------------------------------------------------------------

/** Demand level derived from MarketMeters.Score thresholds */
export const DemandLevel = z.enum(["Low", "Normal", "High", "Surge"]);
export type DemandLevel = z.infer<typeof DemandLevel>;

/** Alert level from RestaurantHealthCache.alertLevel */
export const AlertLevel = z.enum(["star", "warning", "critical"]);
export type AlertLevel = z.infer<typeof AlertLevel>;
