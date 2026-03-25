/**
 * Restaurant schema — maps to ValleyEats-Restaurants DynamoDB table.
 *
 * Key conventions:
 * - RestaurantId is a UUID.
 * - Hours are stored as MINUTES FROM MIDNIGHT (e.g. 660 = 11:00 AM).
 * - LastHeartbeat is Unix epoch seconds — used to determine tablet online status.
 * - Commission is a decimal (0.87 = 87%).
 */

import { z } from "zod";
import { AlertLevel } from "./enums.js";
import { MinutesFromMidnightSchema } from "./common.js";

// ---------------------------------------------------------------------------
// KitchenHours — per-day open/close times in minutes from midnight
// ---------------------------------------------------------------------------

export const DayHoursSchema = z.object({
  open: MinutesFromMidnightSchema.describe("Minutes from midnight — opening time"),
  closed: MinutesFromMidnightSchema.describe("Minutes from midnight — closing time"),
});
export type DayHours = z.infer<typeof DayHoursSchema>;

export const KitchenHoursSchema = z.object({
  Mon: DayHoursSchema.optional(),
  Tue: DayHoursSchema.optional(),
  Wed: DayHoursSchema.optional(),
  Thu: DayHoursSchema.optional(),
  Fri: DayHoursSchema.optional(),
  Sat: DayHoursSchema.optional(),
  Sun: DayHoursSchema.optional(),
});
export type KitchenHours = z.infer<typeof KitchenHoursSchema>;

// ---------------------------------------------------------------------------
// Restaurant
// ---------------------------------------------------------------------------

export const RestaurantSchema = z.object({
  // ---- Identity ----
  /** UUID primary key */
  restaurantId: z.string().uuid().describe("DynamoDB PK: RestaurantId"),
  /** First 8 chars of UUID — human-friendly short code */
  restaurantIdKey: z.string().max(8).describe("DynamoDB: RestaurantIdKey"),
  /** Restaurant display name */
  name: z.string().describe("DynamoDB: RestaurantName"),

  // ---- Contact ----
  phone: z.string().describe("DynamoDB: Phone"),
  email: z.string().optional().describe("DynamoDB: Email"),

  // ---- Location ----
  city: z.string().describe("DynamoDB: City"),
  province: z.string().describe("DynamoDB: Province"),
  deliveryZone: z.string().describe("DynamoDB: DeliveryZone — market name"),

  // ---- Cuisine & display ----
  cuisine: z.string().optional().describe("DynamoDB: PrimaryCuisine"),
  /** Price level 1–3 */
  priceLevel: z.number().int().min(1).max(3).optional().describe("DynamoDB: Price"),

  // ---- Operational flags ----
  /** Whether the restaurant is active on the platform */
  isActive: z.boolean().describe("DynamoDB: Restaurant — active flag"),
  /** Whether delivery is currently enabled */
  deliveryAvailable: z.boolean().describe("DynamoDB: DeliveryAvailable"),

  // ---- Financials ----
  /** Platform commission rate (decimal, e.g. 0.87 = 87%) */
  commission: z.number().min(0).max(1).optional().describe("DynamoDB: Commission"),

  // ---- Prep timing ----
  /** POS estimated prep time in minutes */
  posEta: z.number().int().optional().describe("DynamoDB: POSETA — minutes"),

  // ---- Hours (minutes from midnight) ----
  kitchenHours: KitchenHoursSchema.optional().describe("DynamoDB: KitchenHours"),
  defaultHours: KitchenHoursSchema.optional().describe("DynamoDB: DefaultHours — customer-facing"),

  // ---- Tablet / device health ----
  /** Last tablet heartbeat — Unix epoch seconds */
  lastHeartbeat: z.number().optional().describe("DynamoDB: LastHeartbeat — Unix epoch seconds"),

  // ---- Menu structure ----
  menuSections: z.array(z.string()).optional().describe("DynamoDB: MenuSections — ordered section names"),

  // ---- Computed properties (populated during ontology sync) ----
  /** Whether the restaurant is currently within its kitchen hours */
  isOpen: z.boolean().describe("Computed from KitchenHours + current time"),
  /** Whether the tablet has sent a heartbeat in the last 5 minutes */
  isTabletOnline: z.boolean().describe("Computed: now - lastHeartbeat < 5min"),
  /**
   * Pre-computed health score from RestaurantHealthCache table (0–100).
   * Null if no cached score is available.
   */
  healthScore: z.number().min(0).max(100).nullable().describe("From RestaurantHealthCache"),
  /** Alert level from health cache */
  alertLevel: AlertLevel.nullable().optional().describe("From RestaurantHealthCache.alertLevel"),
  /** Current number of active orders at this restaurant */
  currentLoad: z.number().int().describe("Computed: active orders count"),
});

export type Restaurant = z.infer<typeof RestaurantSchema>;
