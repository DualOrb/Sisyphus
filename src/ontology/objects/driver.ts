/**
 * Driver schema — maps to ValleyEats-Drivers DynamoDB table.
 *
 * Key conventions:
 * - DriverId is an EMAIL ADDRESS, not a UUID.
 * - AgentId is a UUID used as an internal reference.
 * - Real-time status is derived from Available / Paused / Active / ConnectionId.
 */

import { z } from "zod";
import { DriverStatus, AppPermissionLevel } from "./enums.js";

// ---------------------------------------------------------------------------
// AppSettings — embedded sub-schema for device permissions
// ---------------------------------------------------------------------------

export const AppSettingsSchema = z.object({
  camera: AppPermissionLevel.optional().describe("DynamoDB: AppSetting.Camera"),
  geoLocate: AppPermissionLevel.optional().describe("DynamoDB: AppSetting.GeoLocate"),
  microphone: AppPermissionLevel.optional().describe("DynamoDB: AppSetting.Microphone"),
  phone: AppPermissionLevel.optional().describe("DynamoDB: AppSetting.Phone"),
  speech: AppPermissionLevel.optional().describe("DynamoDB: AppSetting.Speech"),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export const DriverSchema = z.object({
  // ---- Identity ----
  /** Email address — primary key in DynamoDB */
  driverId: z.string().email().describe("DynamoDB PK: DriverId — email address"),
  /** Human-readable full name */
  name: z.string().describe("DynamoDB: FullName"),
  /** Phone number */
  phone: z.string().describe("DynamoDB: Phone"),
  /** Short codename used on dispatch board (e.g. "RG", "AGA", "MH") */
  monacher: z.string().optional().describe("DynamoDB: Monacher — dispatch board short name"),
  /** Internal UUID reference */
  agentId: z.string().uuid().optional().describe("DynamoDB: AgentId"),

  // ---- Zone assignment ----
  /** Current dispatch zone (operations-facing) */
  dispatchZone: z.string().describe("DynamoDB: DispatchZone"),
  /** Assigned delivery area (may differ from dispatch zone) */
  deliveryArea: z.string().describe("DynamoDB: DeliveryArea"),
  /** Whether the driver can deliver outside their assigned zone */
  ignoreArea: z.boolean().describe("DynamoDB: ignoreArea"),

  // ---- Raw status flags (from DynamoDB) ----
  /** Currently accepting orders */
  isAvailable: z.boolean().describe("DynamoDB: Available"),
  /** Temporarily paused (break, personal errand, etc.) */
  isPaused: z.boolean().describe("DynamoDB: Paused"),
  /** Employment/activation status */
  isActive: z.boolean().describe("DynamoDB: Active"),

  // ---- Device / connectivity ----
  /** WebSocket connection ID — null means disconnected */
  connectionId: z.string().nullable().describe("DynamoDB: ConnectionId"),
  /** Driver app version string */
  appVersion: z.string().optional().describe("DynamoDB: AppVersion"),
  /** Device model identifier */
  phoneModel: z.string().optional().describe("DynamoDB: phoneModel"),
  /** App permission settings */
  appSettings: AppSettingsSchema.optional().describe("DynamoDB: AppSetting"),

  // ---- Training ----
  /** Number of completed training orders */
  trainingOrders: z.number().int().optional().describe("DynamoDB: TrainingOrders"),

  // ---- Computed properties (populated during ontology sync) ----
  /**
   * Logical online status derived from raw flags:
   * Online = isAvailable && !isPaused && connectionId != null
   */
  status: DriverStatus.describe("Computed from Available/Paused/Active/ConnectionId"),
  /** Whether the driver is connected and taking orders */
  isOnline: z.boolean().describe("Computed: isAvailable && !isPaused && connectionId != null"),
  /** Number of currently active (non-completed/non-cancelled) orders */
  activeOrdersCount: z.number().int().describe("Computed: count from Orders table"),
});

export type Driver = z.infer<typeof DriverSchema>;
