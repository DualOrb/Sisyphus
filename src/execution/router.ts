/**
 * Execution router — directs action names to the correct executor.
 *
 * The guardrails pipeline determines the ExecutionMethod for each action
 * (browser, api, or internal). This router dispatches accordingly.
 *
 * When OPERATING_MODE=shadow, ALL actions are routed through the
 * ShadowExecutor instead of real executors. The shadow executor records
 * what WOULD have happened without performing real side effects.
 *
 * @see planning/09-ontology-layer-design.md section 8.3
 */

import { createChildLogger } from "../lib/logger.js";
import { isShadowMode } from "../config/mode.js";
import type { ExecutionMethod } from "../guardrails/types.js";
import type { ActionExecutor, ExecutionResult } from "./types.js";
import type { ShadowExecutor } from "./shadow/executor.js";

const log = createChildLogger("execution:router");

export class ExecutionRouter {
  private shadowExecutor: ShadowExecutor | null = null;

  constructor(
    private readonly browserExecutor: ActionExecutor,
    private readonly apiExecutor: ActionExecutor,
  ) {}

  /**
   * Attach a shadow executor for shadow-mode routing.
   *
   * When set, and OPERATING_MODE=shadow, all actions are routed here instead
   * of to the real browser/API executors.
   */
  setShadowExecutor(executor: ShadowExecutor): void {
    this.shadowExecutor = executor;

    // Pre-populate method mappings so proposals know what WOULD have been used.
    // Individual actions are also registered at route-time for any not yet known.
    log.info("Shadow executor attached to router");
  }

  /**
   * Route an action to the appropriate executor based on the declared method.
   *
   * - "browser" — delegates to the BrowserExecutor (Playwright)
   * - "api"     — delegates to the ApiExecutor (REST calls)
   * - "internal" — returns immediate success (no external call needed,
   *                e.g. flagging, escalation, internal bookkeeping)
   *
   * In shadow mode, all actions are intercepted by the ShadowExecutor.
   */
  async route(
    actionName: string,
    method: ExecutionMethod,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const start = Date.now();

    // Shadow mode: intercept ALL actions
    if (isShadowMode() && this.shadowExecutor) {
      log.info(
        { actionName, method, mode: "shadow" },
        "Shadow mode — routing to shadow executor",
      );

      // Record what method WOULD have been used
      this.shadowExecutor.setMethodForAction(actionName, method);

      return this.shadowExecutor.execute(actionName, params);
    }

    log.info({ actionName, method }, "Routing action to executor");

    switch (method) {
      case "browser": {
        log.debug({ actionName }, "Delegating to browser executor");
        return this.browserExecutor.execute(actionName, params);
      }

      case "api": {
        log.debug({ actionName }, "Delegating to API executor");
        return this.apiExecutor.execute(actionName, params);
      }

      case "internal": {
        const duration = Date.now() - start;
        log.debug({ actionName, duration }, "Internal action — no external execution required");
        return {
          success: true,
          method: "internal",
          duration,
          data: { note: "Internal action completed without external call" },
        };
      }

      default: {
        const duration = Date.now() - start;
        const exhaustiveCheck: never = method;
        log.error({ actionName, method: exhaustiveCheck }, "Unknown execution method");
        return {
          success: false,
          method: "internal",
          duration,
          error: `Unknown execution method: "${method}"`,
        };
      }
    }
  }
}
