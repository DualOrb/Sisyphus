/**
 * Shared sub-schemas and branded types for the Sisyphus ontology layer.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// GeoPoint — latitude / longitude pair
// ---------------------------------------------------------------------------

export const GeoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof GeoPointSchema>;

// ---------------------------------------------------------------------------
// TimeRange — generic start/end pair (Unix epoch seconds)
// ---------------------------------------------------------------------------

export const TimeRangeSchema = z.object({
  start: z.number().int().describe("Unix epoch seconds"),
  end: z.number().int().describe("Unix epoch seconds"),
});
export type TimeRange = z.infer<typeof TimeRangeSchema>;

// ---------------------------------------------------------------------------
// MoneyInCents — branded number to prevent cents / dollars confusion
//
// All monetary values in ValleyEats-Orders are stored as integer CENTS
// (e.g. 6695 = $66.95). This branded type makes the unit explicit at the
// type level so callers never accidentally divide or display raw numbers.
// ---------------------------------------------------------------------------

/**
 * A branded number representing a monetary value in **cents** (integer).
 *
 * Zod schema: accepts any integer and brands it so TypeScript treats it
 * differently from a bare `number`.
 */
export const MoneyInCentsSchema = z
  .number()
  .int()
  .brand<"MoneyInCents">();

export type MoneyInCents = z.infer<typeof MoneyInCentsSchema>;

// ---------------------------------------------------------------------------
// MinutesFromMidnight — branded number for time-of-day values
//
// Restaurant hours in ValleyEats are stored as minutes from midnight
// (e.g. 660 = 11:00 AM, 1320 = 10:00 PM).
// ---------------------------------------------------------------------------

export const MinutesFromMidnightSchema = z
  .number()
  .int()
  .min(0)
  .max(1440)
  .brand<"MinutesFromMidnight">();

export type MinutesFromMidnight = z.infer<typeof MinutesFromMidnightSchema>;

// ---------------------------------------------------------------------------
// Helpers — pure functions, no side effects
// ---------------------------------------------------------------------------

/** Convert cents to a display-friendly dollar string: 6695 → "$66.95" */
export function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Convert minutes-from-midnight to "HH:MM" string: 660 → "11:00" */
export function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}
