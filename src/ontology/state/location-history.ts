/**
 * Driver location history tracker.
 *
 * Accumulates GPS snapshots for each driver over time. Each snapshot records
 * a driver's position at a point in time. The history is capped at a
 * configurable window (default 60 minutes) and pruned automatically.
 *
 * Snapshots are recorded at most once per minute per driver to avoid
 * excessive memory use from the ~20-second sync interval.
 *
 * Used by AI agents to answer questions like:
 *   - Has this driver moved in the last 5 minutes?
 *   - Where was this driver 10 minutes ago?
 *   - How far has this driver traveled since pickup?
 */

import type { GeoPoint } from "../objects/common.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LocationSnapshot {
  /** Unix epoch seconds */
  timestamp: number;
  location: GeoPoint;
}

export interface DriverLocationSummary {
  driverId: string;
  current: GeoPoint | null;
  snapshots: LocationSnapshot[];
  /** Distance traveled (meters) over the available history */
  distanceTraveledMeters: number;
  /** Whether the driver has moved more than 50m in the last N minutes */
  hasMovedRecently: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum history window in seconds (default: 60 minutes) */
const DEFAULT_MAX_AGE_SECONDS = 60 * 60;

/** Minimum interval between snapshots for the same driver (seconds) */
const MIN_SNAPSHOT_INTERVAL_SECONDS = 60;

/** Threshold in meters to consider a driver as "moved" */
const MOVEMENT_THRESHOLD_METERS = 50;

/** Default "recently" window for hasMovedRecently (minutes) */
const DEFAULT_RECENT_MINUTES = 5;

// ---------------------------------------------------------------------------
// DriverLocationHistory
// ---------------------------------------------------------------------------

export class DriverLocationHistory {
  /** Map of driverId → sorted array of snapshots (oldest first) */
  private readonly history = new Map<string, LocationSnapshot[]>();
  private readonly maxAgeSeconds: number;

  constructor(maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS) {
    this.maxAgeSeconds = maxAgeSeconds;
  }

  // ---- Recording ----------------------------------------------------------

  /**
   * Record a location for a driver. Deduplicates: if the last snapshot for
   * this driver is less than MIN_SNAPSHOT_INTERVAL_SECONDS ago, the new
   * point is silently dropped.
   *
   * @param driverId  Driver email / ID
   * @param location  GPS point
   * @param timestamp Optional Unix epoch seconds (defaults to now)
   */
  record(driverId: string, location: GeoPoint, timestamp?: number): void {
    const ts = timestamp ?? Math.floor(Date.now() / 1000);
    let snapshots = this.history.get(driverId);

    if (!snapshots) {
      snapshots = [];
      this.history.set(driverId, snapshots);
    }

    // Dedup: skip if too recent
    const last = snapshots[snapshots.length - 1];
    if (last && ts - last.timestamp < MIN_SNAPSHOT_INTERVAL_SECONDS) {
      return;
    }

    snapshots.push({ timestamp: ts, location });
  }

  /**
   * Bulk-record locations from a sync cycle. Iterates all drivers and
   * records their current position if available.
   */
  recordFromDrivers(
    drivers: Iterable<{ driverId: string; currentLocation: GeoPoint | null }>,
    timestamp?: number,
  ): void {
    for (const d of drivers) {
      if (d.currentLocation) {
        this.record(d.driverId, d.currentLocation, timestamp);
      }
    }
  }

  /**
   * Seed historical snapshots from a parsed dispatch.txt snapshot.
   * Used on startup to backfill from DispatchImages.
   *
   * @param data      Parsed dispatch.txt JSON (zone-keyed with Drivers arrays)
   * @param timestamp Unix epoch seconds for this snapshot
   */
  seedFromDispatchSnapshot(data: Record<string, any>, timestamp: number): void {
    const zones = Object.keys(data).filter((k) => k !== "Timestamp");

    for (const zone of zones) {
      const drivers = data[zone]?.Drivers;
      if (!Array.isArray(drivers)) continue;

      for (const d of drivers) {
        if (d?.DriverLocation?.latitude != null) {
          this.record(
            d.DriverId,
            {
              latitude: Number(d.DriverLocation.latitude),
              longitude: Number(d.DriverLocation.longitude),
            },
            timestamp,
          );
        }
      }
    }
  }

  // ---- Pruning -------------------------------------------------------------

  /** Remove all snapshots older than maxAgeSeconds. */
  prune(): void {
    const cutoff = Math.floor(Date.now() / 1000) - this.maxAgeSeconds;

    for (const [driverId, snapshots] of this.history) {
      const idx = snapshots.findIndex((s) => s.timestamp >= cutoff);
      if (idx === -1) {
        // All snapshots are stale
        this.history.delete(driverId);
      } else if (idx > 0) {
        snapshots.splice(0, idx);
      }
    }
  }

  // ---- Queries -------------------------------------------------------------

  /**
   * Get all snapshots for a driver within the last N minutes.
   */
  getHistory(driverId: string, lastMinutes?: number): LocationSnapshot[] {
    const snapshots = this.history.get(driverId);
    if (!snapshots || snapshots.length === 0) return [];

    if (lastMinutes == null) return [...snapshots];

    const cutoff = Math.floor(Date.now() / 1000) - lastMinutes * 60;
    return snapshots.filter((s) => s.timestamp >= cutoff);
  }

  /**
   * Get the location of a driver at a specific point in the past.
   * Returns the closest snapshot at or before the given time.
   */
  getLocationAt(driverId: string, minutesAgo: number): LocationSnapshot | null {
    const snapshots = this.history.get(driverId);
    if (!snapshots || snapshots.length === 0) return null;

    const targetTs = Math.floor(Date.now() / 1000) - minutesAgo * 60;

    // Binary-ish search: find the last snapshot at or before targetTs
    let best: LocationSnapshot | null = null;
    for (const s of snapshots) {
      if (s.timestamp <= targetTs) {
        best = s;
      } else {
        break; // snapshots are sorted
      }
    }

    return best;
  }

  /**
   * Check if a driver has moved more than the threshold distance
   * in the last N minutes.
   */
  hasMovedRecently(
    driverId: string,
    lastMinutes = DEFAULT_RECENT_MINUTES,
  ): boolean {
    const recent = this.getHistory(driverId, lastMinutes);
    if (recent.length < 2) return false;

    const first = recent[0];
    const last = recent[recent.length - 1];
    const dist = haversineMeters(first.location, last.location);
    return dist > MOVEMENT_THRESHOLD_METERS;
  }

  /**
   * Calculate total distance traveled by a driver over the last N minutes.
   */
  distanceTraveled(driverId: string, lastMinutes?: number): number {
    const snapshots = this.getHistory(driverId, lastMinutes);
    if (snapshots.length < 2) return 0;

    let total = 0;
    for (let i = 1; i < snapshots.length; i++) {
      total += haversineMeters(
        snapshots[i - 1].location,
        snapshots[i].location,
      );
    }
    return Math.round(total);
  }

  /**
   * Get a full summary for a driver, suitable for returning to AI tools.
   */
  getSummary(
    driverId: string,
    lastMinutes?: number,
  ): DriverLocationSummary {
    const snapshots = this.getHistory(driverId, lastMinutes);
    const current = snapshots.length > 0
      ? snapshots[snapshots.length - 1].location
      : null;

    return {
      driverId,
      current,
      snapshots,
      distanceTraveledMeters: this.distanceTraveled(driverId, lastMinutes),
      hasMovedRecently: this.hasMovedRecently(driverId),
    };
  }

  /**
   * Get summaries for all tracked drivers.
   */
  getAllDriverIds(): string[] {
    return [...this.history.keys()];
  }

  /** Total number of tracked drivers */
  get size(): number {
    return this.history.size;
  }

  /** Total number of snapshots across all drivers */
  get totalSnapshots(): number {
    let total = 0;
    for (const snapshots of this.history.values()) {
      total += snapshots.length;
    }
    return total;
  }
}

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

/** Haversine distance between two GeoPoints in meters. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      sinDLon * sinDLon;

  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
