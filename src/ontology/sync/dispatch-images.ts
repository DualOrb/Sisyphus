/**
 * DispatchImages S3 fetcher.
 *
 * On startup, fetches the last N minutes of archived dispatch.txt snapshots
 * from `s3://valleyeats/DispatchImages/{date}/{timestamp}.txt` and feeds
 * them into DriverLocationHistory for backfill.
 *
 * The dispatch Lambda saves a snapshot every ~20 seconds. We sample at
 * 1-per-minute to keep startup fast and memory reasonable.
 */

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import type { Logger } from "../../lib/logger.js";
import type { DriverLocationHistory } from "../state/location-history.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUCKET = "valleyeats";
const SNAPSHOT_INTERVAL_SECONDS = 20;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SeedOptions {
  /** How many minutes of history to backfill (default: 10) */
  minutes?: number;
  /** S3 region (default: us-east-1) */
  region?: string;
}

/**
 * Fetch recent DispatchImages from S3 and seed the location history.
 *
 * Retrieves ~1 snapshot per minute for the specified window, parses
 * each one, and feeds driver locations into the history tracker.
 */
export async function seedLocationHistoryFromS3(
  locationHistory: DriverLocationHistory,
  logger: Logger,
  opts: SeedOptions = {},
): Promise<void> {
  const minutes = opts.minutes ?? 10;
  const region = opts.region ?? "us-east-1";

  const s3 = new S3Client({ region });
  const now = Math.floor(Date.now() / 1000);

  // DispatchImages are organized by Eastern time date
  // We need to check today's folder (and possibly yesterday's if near midnight)
  const dates = getDateFolders(now);

  logger.info(
    { minutes, dates },
    `Seeding location history from DispatchImages (last ${minutes} min)`,
  );

  // List all available timestamps for today
  const allTimestamps: number[] = [];

  for (const dateStr of dates) {
    try {
      const timestamps = await listSnapshotTimestamps(s3, dateStr);
      allTimestamps.push(...timestamps);
    } catch (err) {
      logger.warn(
        { err, date: dateStr },
        "Failed to list DispatchImages for date",
      );
    }
  }

  if (allTimestamps.length === 0) {
    logger.info("No DispatchImages found — skipping location history seed");
    return;
  }

  // Sort ascending
  allTimestamps.sort((a, b) => a - b);

  // Pick ~1 per minute within our window
  const cutoff = now - minutes * 60;
  const selected = sampleOnePerMinute(
    allTimestamps.filter((ts) => ts >= cutoff),
  );

  logger.info(
    { available: allTimestamps.length, selected: selected.length, cutoff },
    `Selected ${selected.length} snapshots to seed from ${allTimestamps.length} available`,
  );

  // Fetch and parse each selected snapshot
  let seeded = 0;
  for (const ts of selected) {
    try {
      const data = await fetchSnapshot(s3, ts);
      if (data) {
        locationHistory.seedFromDispatchSnapshot(data, ts);
        seeded++;
      }
    } catch (err) {
      logger.warn({ err, timestamp: ts }, "Failed to fetch/parse DispatchImage");
    }
  }

  logger.info(
    {
      seeded,
      totalDrivers: locationHistory.size,
      totalSnapshots: locationHistory.totalSnapshots,
    },
    `Location history seeded: ${seeded} snapshots, ${locationHistory.size} drivers tracked`,
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Get date folder strings (YYYY-MM-DD) that might contain recent snapshots. */
function getDateFolders(nowEpoch: number): string[] {
  // DispatchImages use Eastern time for folder names
  const eastern = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const today = eastern.format(new Date(nowEpoch * 1000));
  const yesterday = eastern.format(new Date((nowEpoch - 86400) * 1000));

  // If it's early in the day, we might need yesterday's folder too
  const hour = new Date(nowEpoch * 1000).getHours();
  if (hour < 1) {
    return [yesterday, today];
  }
  return [today];
}

/** List all snapshot timestamps in a DispatchImages date folder. */
async function listSnapshotTimestamps(
  s3: S3Client,
  dateStr: string,
): Promise<number[]> {
  const timestamps: number[] = [];
  let continuationToken: string | undefined;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: `DispatchImages/${dateStr}/`,
      ContinuationToken: continuationToken,
    });

    const result = await s3.send(cmd);

    for (const obj of result.Contents ?? []) {
      if (!obj.Key) continue;
      // Key format: DispatchImages/2026-03-26/1774477790.txt
      const filename = obj.Key.split("/").pop() ?? "";
      const ts = parseInt(filename.replace(".txt", ""), 10);
      if (!isNaN(ts)) {
        timestamps.push(ts);
      }
    }

    continuationToken = result.IsTruncated
      ? result.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return timestamps;
}

/**
 * From a sorted array of timestamps (~20s apart), pick approximately
 * one per minute by taking every 3rd entry.
 */
function sampleOnePerMinute(sorted: number[]): number[] {
  if (sorted.length === 0) return [];

  const result: number[] = [sorted[0]];
  let lastPicked = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    // Pick if at least 55 seconds since last pick (allows for jitter)
    if (sorted[i] - lastPicked >= 55) {
      result.push(sorted[i]);
      lastPicked = sorted[i];
    }
  }

  return result;
}

/** Fetch and parse a single DispatchImage snapshot from S3. */
async function fetchSnapshot(
  s3: S3Client,
  timestamp: number,
): Promise<Record<string, any> | null> {
  // Reconstruct the date folder from the timestamp
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp * 1000));

  // Round to nearest multiple of 20 (matching PHP logic)
  const rounded = Math.floor(timestamp / SNAPSHOT_INTERVAL_SECONDS) * SNAPSHOT_INTERVAL_SECONDS;

  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key: `DispatchImages/${dateStr}/${rounded}.txt`,
  });

  try {
    const result = await s3.send(cmd);
    const body = await result.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body);
  } catch (err: any) {
    // Try the exact timestamp if rounded didn't work
    if (err?.name === "NoSuchKey" && rounded !== timestamp) {
      const retryCmd = new GetObjectCommand({
        Bucket: BUCKET,
        Key: `DispatchImages/${dateStr}/${timestamp}.txt`,
      });
      const result = await s3.send(retryCmd);
      const body = await result.Body?.transformToString();
      if (!body) return null;
      return JSON.parse(body);
    }
    throw err;
  }
}
