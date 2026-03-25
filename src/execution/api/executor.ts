/**
 * API executor — translates ontology actions into direct REST API calls.
 *
 * Used for high-frequency or background operations that don't need to be
 * visually performed in the browser UI. Faster than browser execution.
 *
 * @see planning/09-ontology-layer-design.md section 8.2
 */

import { createChildLogger } from "../../lib/logger.js";
import type { ActionExecutor, ExecutionResult } from "../types.js";
import type { DispatchApiWriter } from "./client.js";

const log = createChildLogger("execution:api:executor");

export class ApiExecutor implements ActionExecutor {
  constructor(private readonly apiWriter: DispatchApiWriter) {}

  async execute(
    actionName: string,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const start = Date.now();
    log.info({ actionName, params }, "API executor: starting action");

    try {
      switch (actionName) {
        case "AddTicketNote": {
          const result = await this.apiWriter.addIssueNote(
            params.ticketId as string,
            params.note as string,
          );
          return this.toResult(start, result);
        }

        case "UpdateIssueStatus": {
          const result = await this.apiWriter.updateIssueStatus(
            params.issueId as string,
            params.status as string,
          );
          return this.toResult(start, result);
        }

        case "UpdateIssueOwner": {
          const result = await this.apiWriter.updateIssueOwner(
            params.issueId as string,
            params.owner as string,
          );
          return this.toResult(start, result);
        }

        case "MarkConversationRead": {
          const result = await this.apiWriter.markConversationRead(
            params.driverId as string,
          );
          return this.toResult(start, result);
        }

        case "FlagMarketIssue": {
          // FlagMarketIssue is an internal bookkeeping action. The ontology
          // creates a MarketAlert object and notifies the supervisor agent.
          // No external API call is needed — the flag exists in Sisyphus state.
          // We still route through the API executor for audit/logging consistency.
          const duration = Date.now() - start;
          log.info(
            { zoneId: params.zoneId, issueType: params.issueType },
            "Market issue flagged (internal)",
          );
          return {
            success: true,
            method: "api",
            duration,
            data: {
              zoneId: params.zoneId,
              issueType: params.issueType,
              severity: params.severity,
              details: params.details,
            },
          };
        }

        default: {
          const duration = Date.now() - start;
          log.warn({ actionName }, "API executor: unknown action");
          return {
            success: false,
            method: "api",
            duration,
            error: `API executor does not handle action "${actionName}"`,
          };
        }
      }
    } catch (error) {
      const duration = Date.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      log.error({ actionName, duration, error: message }, "API executor: action failed");
      return { success: false, method: "api", duration, error: message };
    }
  }

  // -------------------------------------------------------------------------
  // Internal helper
  // -------------------------------------------------------------------------

  /**
   * Convert an ApiWriteResult into an ExecutionResult.
   */
  private toResult(
    start: number,
    apiResult: { success: boolean; data?: unknown; error?: string },
  ): ExecutionResult {
    return {
      success: apiResult.success,
      method: "api",
      duration: Date.now() - start,
      data: apiResult.data,
      error: apiResult.error,
    };
  }
}
