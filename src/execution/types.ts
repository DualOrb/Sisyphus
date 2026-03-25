/**
 * Shared types for the Sisyphus execution layer.
 *
 * The execution layer translates ontology actions into real-world effects —
 * either via browser automation (Playwright) or direct REST API calls.
 *
 * @see planning/09-ontology-layer-design.md section 8
 */

// Re-export ExecutionMethod from guardrails where it's the canonical definition.
// This avoids duplicate type declarations while keeping execution-layer imports clean.
export type { ExecutionMethod } from "../guardrails/types.js";

// ---------------------------------------------------------------------------
// Execution result — returned by every executor after attempting an action
// ---------------------------------------------------------------------------

export interface ExecutionResult {
  /** Whether the action completed successfully. */
  success: boolean;
  /** Which executor handled the action. */
  method: "browser" | "api" | "internal" | "shadow";
  /** Wall-clock duration in milliseconds. */
  duration: number;
  /** Human-readable error message when success is false. */
  error?: string;
  /** Arbitrary payload returned by the executor (e.g. API response body). */
  data?: unknown;
}

// ---------------------------------------------------------------------------
// ActionExecutor — the interface both browser and API executors implement
// ---------------------------------------------------------------------------

export interface ActionExecutor {
  /**
   * Execute a named action with the given parameters.
   *
   * Implementations must NOT throw — they return a failed ExecutionResult instead.
   */
  execute(
    actionName: string,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult>;
}
