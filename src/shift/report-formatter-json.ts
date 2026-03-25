/**
 * JSON formatter for Sisyphus shift reports.
 *
 * Produces pretty-printed JSON for programmatic consumption — dashboards,
 * trend analysis, or integration with external monitoring systems.
 *
 * @module shift/report-formatter-json
 */

import type { ShiftReport } from "./report.js";

/**
 * Serialise a ShiftReport to pretty-printed JSON.
 *
 * The output is deterministic (keys in declaration order, 2-space indent)
 * and suitable for writing directly to a file or sending via an API.
 */
export function formatReportAsJson(report: ShiftReport): string {
  return JSON.stringify(report, null, 2);
}
