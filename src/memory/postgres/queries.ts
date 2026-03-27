import { desc, eq, and, gt, sql } from "drizzle-orm";
import {
  auditLog,
  shiftSummary,
  entityInteractions,
  type AuditLogRecord,
  type AuditLogRow,
  type ShiftSummaryRecord,
  type EntityInteractionRow,
  type ShiftSummaryRow,
} from "../../../db/schema.js";
import type { PostgresDb } from "./client.js";

/**
 * Fetch recent interactions for an entity within the last N days.
 * Used for cross-shift awareness ("this customer called before").
 *
 * @param db    - Drizzle instance
 * @param entityType - e.g. "driver", "customer", "order"
 * @param entityId   - the entity's ID (email, UUID, etc.)
 * @param days       - look-back window (default 7)
 * @returns Up to 20 most recent interactions, newest first
 */
export async function getEntityHistory(
  db: PostgresDb,
  entityType: string,
  entityId: string,
  days = 7,
): Promise<EntityInteractionRow[]> {
  return db
    .select()
    .from(entityInteractions)
    .where(
      and(
        eq(entityInteractions.entityType, entityType),
        eq(entityInteractions.entityId, entityId),
        gt(
          entityInteractions.timestamp,
          sql`now() - make_interval(days => ${days})`,
        ),
      ),
    )
    .orderBy(desc(entityInteractions.timestamp))
    .limit(20);
}

/**
 * Get the most recent shift summary for handoff.
 * Returns yesterday's shift (or the latest one before today).
 *
 * @returns The previous shift's summary, or `null` if none exists.
 */
export async function getShiftHandoff(
  db: PostgresDb,
): Promise<ShiftSummaryRow | null> {
  const rows = await db
    .select()
    .from(shiftSummary)
    .where(eq(shiftSummary.shiftDate, sql`current_date - 1`))
    .orderBy(desc(shiftSummary.endTime))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Insert an audit log record for a dispatching action.
 *
 * @param db     - Drizzle instance
 * @param record - Audit log fields (id auto-generated if omitted)
 */
export async function writeAuditRecord(
  db: PostgresDb,
  record: AuditLogRecord,
): Promise<void> {
  await db.insert(auditLog).values(record);
}

/**
 * Fetch recent audit log records for the dashboard.
 *
 * @param db    - Drizzle instance
 * @param limit - max rows to return (default 200, max 500)
 * @returns Recent audit records, newest first
 */
export async function getRecentAuditRecords(
  db: PostgresDb,
  limit = 200,
): Promise<AuditLogRow[]> {
  return db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.timestamp))
    .limit(Math.min(limit, 500));
}

/**
 * Insert a shift summary record.
 *
 * @param db      - Drizzle instance
 * @param summary - Shift summary fields (id auto-generated if omitted)
 */
export async function writeShiftSummary(
  db: PostgresDb,
  summary: ShiftSummaryRecord,
): Promise<void> {
  await db.insert(shiftSummary).values(summary);
}
