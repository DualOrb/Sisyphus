/**
 * DeliveryZone / Market schema — combines data from:
 *   - ValleyEats-MarketMeters (real-time demand scores)
 *   - ValleyEats-Alerts (ETA per market)
 *   - ValleyEats-DemandPredictions (ML forecasts)
 *
 * Key conventions:
 * - Market is a PascalCase string (e.g. "PortElgin", "Petawawa").
 * - MarketMeters.Score: 0 = oversupplied, 100 = critical driver shortage.
 * - Alerts.Eta is a string that should be parsed to a number (minutes).
 * - DemandPredictions are per-week per-market arrays.
 */

import { z } from "zod";
import { DemandLevel } from "./enums.js";

// ---------------------------------------------------------------------------
// DemandPrediction — individual time-slot forecast
// ---------------------------------------------------------------------------

export const DemandPredictionSchema = z.object({
  /** ISO date string (e.g. "2026-01-06") */
  date: z.string().describe("DemandPredictions.Predictions[].date"),
  /** Day name (e.g. "Tuesday") */
  dayOfWeek: z.string().describe("DemandPredictions.Predictions[].day_of_week"),
  /** Time in "HH:MM" format */
  time: z.string().describe("DemandPredictions.Predictions[].time"),
  /** Predicted number of drivers needed */
  driversPredicted: z.number().int().describe("DemandPredictions.Predictions[].drivers_predicted"),
  /** Lower bound of prediction interval */
  driversMin: z.number().int().describe("DemandPredictions.Predictions[].drivers_min"),
  /** Upper bound of prediction interval */
  driversMax: z.number().int().describe("DemandPredictions.Predictions[].drivers_max"),
});
export type DemandPrediction = z.infer<typeof DemandPredictionSchema>;

// ---------------------------------------------------------------------------
// DemandPredictionMetadata
// ---------------------------------------------------------------------------

export const DemandPredictionMetadataSchema = z.object({
  /** Model confidence level */
  modelConfidence: z.string().optional().describe("DemandPredictions.Metadata.model_confidence"),
  /** Prediction period identifier (e.g. "2026-W2") */
  predictionPeriod: z.string().optional().describe("DemandPredictions.Metadata.prediction_period"),
  /** Number of training data points used */
  trainingDataPoints: z.number().int().optional().describe("DemandPredictions.Metadata.training_data_points"),
  /** ISO datetime when prediction was generated */
  generatedAt: z.string().optional().describe("DemandPredictions.Metadata.generated_at"),
});
export type DemandPredictionMetadata = z.infer<typeof DemandPredictionMetadataSchema>;

// ---------------------------------------------------------------------------
// Market (DeliveryZone)
// ---------------------------------------------------------------------------

export const MarketSchema = z.object({
  // ---- Identity ----
  /** Market name — primary key (PascalCase, e.g. "PortElgin") */
  market: z.string().describe("DynamoDB PK: MarketMeters.Market"),

  // ---- Real-time metrics (from MarketMeters) ----
  /**
   * Market health / demand score (0–100).
   * 0 = oversupplied with drivers, 100 = critical driver shortage.
   */
  score: z.number().min(0).max(100).describe("MarketMeters.Score"),
  /** How many drivers are currently needed */
  idealDrivers: z.number().int().describe("MarketMeters.idealDrivers"),
  /** How many drivers are currently available */
  availableDrivers: z.number().int().describe("MarketMeters.drivers"),
  /** When this market meter snapshot was last updated — Unix epoch seconds */
  lastUpdated: z.coerce.date().describe("MarketMeters.ts"),

  // ---- ETA (from Alerts table) ----
  /** Current estimated delivery time in minutes for this market */
  eta: z.number().nullable().optional().describe("Alerts.Eta — minutes (parsed from string)"),

  // ---- Demand predictions (from DemandPredictions) ----
  /** ML-generated forecasts for upcoming time slots */
  demandPredictions: z.array(DemandPredictionSchema).optional()
    .describe("DemandPredictions.Predictions"),
  /** Metadata about the prediction model */
  demandPredictionMeta: DemandPredictionMetadataSchema.optional()
    .describe("DemandPredictions.Metadata"),

  // ---- Computed properties (populated during ontology sync) ----
  /** Gap between ideal and available drivers (positive = shortage) */
  driverGap: z.number().int().describe("Computed: idealDrivers - availableDrivers"),
  /** Demand level derived from score thresholds */
  demandLevel: DemandLevel.describe("Computed from score thresholds"),
  /** Count of active orders in this market zone */
  activeOrders: z.number().int().describe("Computed: count from Orders by zone"),
  /** Ratio of available drivers to active orders */
  driverToOrderRatio: z.number().nullable().describe("Computed: availableDrivers / activeOrders"),
});

export type Market = z.infer<typeof MarketSchema>;
