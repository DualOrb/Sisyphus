/**
 * Task Executor sub-agent (shared utility).
 *
 * Performs administrative tasks that any other agent might need done
 * during its work. Any agent (including the supervisor) can invoke it.
 *
 * NOTE: Restaurant admin actions (UpdateRestaurant, ToggleMenuItem,
 * PauseRestaurant, UnpauseRestaurant, UpdateDeliveryZone) are NOT yet
 * registered in the ontology. This agent's capabilities are currently
 * limited to query_restaurants and the actions listed in the preamble.
 * Restaurant admin actions must be added before task_executor can
 * perform those tasks.
 *
 * @see planning/03-agent-design.md section 2.5
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DynamicStructuredTool } from "@langchain/core/tools";

// ---------------------------------------------------------------------------
// Agent identity
// ---------------------------------------------------------------------------

export const TASK_EXECUTOR_NAME = "task_executor";

export const TASK_EXECUTOR_PREAMBLE = readFileSync(
  resolve(new URL(".", import.meta.url).pathname, "role.md"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// Tool filter
// ---------------------------------------------------------------------------

const ALLOWED_TOOL_NAMES = new Set([
  "query_restaurants",
  "execute_action",
  "request_clarification",
  "lookup_process",
]);

/**
 * Filter the full ontology tool set to only those the task executor
 * is authorised to use.
 */
export function filterTaskExecutorTools(
  allTools: DynamicStructuredTool[],
): DynamicStructuredTool[] {
  return allTools.filter((t) => ALLOWED_TOOL_NAMES.has(t.name));
}

