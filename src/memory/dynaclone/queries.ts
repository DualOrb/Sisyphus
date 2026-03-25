/**
 * Pre-built DynaClone queries for the Sisyphus dispatch AI.
 *
 * Each function executes a parameterised read-only query against the DynaClone
 * MySQL replica and returns typed results.
 *
 * Table names are backtick-quoted DynamoDB names (e.g. `ValleyEats-Orders`).
 */

import type { RowDataPacket } from "mysql2/promise";
import type { DynaCloneClient } from "./client.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ActiveDriverOnShift extends RowDataPacket {
  DriverId: string;
  shiftstart: number;
  shiftend: number;
  FullName: string;
  Available: number;
  Paused: number;
}

export interface OnCallDriver extends RowDataPacket {
  DriverId: string;
  FullName: string;
  Phone: string;
}

export interface PredictedDriverCount extends RowDataPacket {
  count: number;
}

export interface OrderSubtotalRow extends RowDataPacket {
  OrderSubtotal: number;
}

export interface DriverDeliveryStats extends RowDataPacket {
  totalOrders: number;
  avgDeliveryTime: number | null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Drivers currently on shift in a given market.
 *
 * Joins DriverShifts with Drivers to get availability status and name.
 * "Currently on shift" means `shiftstart < NOW() AND shiftend > NOW()`.
 */
export async function getActiveDriversOnShift(
  client: DynaCloneClient,
  market: string,
): Promise<ActiveDriverOnShift[]> {
  const sql = `
    SELECT a.DriverId, a.shiftstart, a.shiftend, b.FullName, b.Available, b.Paused
    FROM \`ValleyEats-DriverShifts\` a
    JOIN \`ValleyEats-Drivers\` b ON a.DriverId = b.DriverId
    WHERE a.shiftstart < UNIX_TIMESTAMP()
      AND a.shiftend > UNIX_TIMESTAMP()
      AND a.area = ?
  `;
  return client.query<ActiveDriverOnShift>(sql, [market]);
}

/**
 * Available on-call drivers in a market (not paused, marked available).
 *
 * These are drivers who haven't necessarily scheduled a shift but have
 * toggled themselves as available in the app.
 */
export async function getAvailableOnCallDrivers(
  client: DynaCloneClient,
  market: string,
): Promise<OnCallDriver[]> {
  const sql = `
    SELECT DriverId, FullName, Phone
    FROM \`ValleyEats-Drivers\`
    WHERE Available = 1 AND DeliveryArea = ? AND Paused != 1
  `;
  return client.query<OnCallDriver>(sql, [market]);
}

/**
 * Predicted number of drivers who will be on shift at a future time.
 *
 * Useful for capacity planning: "How many drivers will we have at 6 PM?"
 */
export async function getPredictedDriverCount(
  client: DynaCloneClient,
  market: string,
  futureTimestamp: number,
): Promise<number> {
  const sql = `
    SELECT COUNT(*) as count
    FROM \`ValleyEats-DriverShifts\`
    WHERE shiftstart <= ? AND shiftend >= ? AND area = ?
  `;
  const rows = await client.query<PredictedDriverCount>(sql, [
    futureTimestamp,
    futureTimestamp,
    market,
  ]);
  return rows[0]?.count ?? 0;
}

/**
 * Quick single-field lookup of an order's subtotal (in cents).
 */
export async function getOrderSubtotal(
  client: DynaCloneClient,
  orderId: string,
): Promise<number | null> {
  const sql = `
    SELECT OrderSubtotal FROM \`ValleyEats-Orders\` WHERE OrderId = ?
  `;
  const rows = await client.query<OrderSubtotalRow>(sql, [orderId]);
  return rows[0]?.OrderSubtotal ?? null;
}

/**
 * Driver delivery performance stats over a date range.
 *
 * Returns total completed deliveries and average delivery time (seconds
 * between OrderReadyTime and OrderDeliveredTime).
 *
 * @param startDate - Unix epoch (seconds) for range start
 * @param endDate - Unix epoch (seconds) for range end
 */
export async function getDriverDeliveryStats(
  client: DynaCloneClient,
  driverId: string,
  startDate: number,
  endDate: number,
): Promise<DriverDeliveryStats> {
  const sql = `
    SELECT COUNT(*) as totalOrders,
           AVG(OrderDeliveredTime - OrderReadyTime) as avgDeliveryTime
    FROM \`ValleyEats-Orders\`
    WHERE DriverId = ? AND OrderStatus = 'Completed'
      AND OrderDeliveredTime BETWEEN ? AND ?
  `;
  const rows = await client.query<DriverDeliveryStats>(sql, [
    driverId,
    startDate,
    endDate,
  ]);
  if (!rows[0]) {
    return { totalOrders: 0, avgDeliveryTime: null } as DriverDeliveryStats;
  }
  return rows[0];
}
