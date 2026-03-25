/**
 * Execution router — directs action names to the correct executor.
 *
 * The guardrails pipeline determines the ExecutionMethod for each action
 * (browser, api, or internal). This router dispatches accordingly.
 *
 * @see planning/09-ontology-layer-design.md section 8.3
 */

import { createChildLogger } from "../lib/logger.js";
import type { ExecutionMethod } from "../guardrails/types.js";
import type { ActionExecutor, ExecutionResult } from "./types.js";

const log = createChildLogger("execution:router");

export class ExecutionRouter {
  constructor(
    private readonly browserExecutor: ActionExecutor,
    private readonly apiExecutor: ActionExecutor,
  ) {}

  /**
   * Route an action to the appropriate executor based on the declared method.
   *
   * - "browser" — delegates to the BrowserExecutor (Playwright)
   * - "api"     — delegates to the ApiExecutor (REST calls)
   * - "internal" — returns immediate success (no external call needed,
   *                e.g. flagging, escalation, internal bookkeeping)
   */
  async route(
    actionName: string,
    method: ExecutionMethod,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const start = Date.now();

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
