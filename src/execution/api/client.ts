/**
 * Dispatch API writer — performs write operations against the dispatch-new REST API.
 *
 * This client handles POST requests for actions that don't need to be visible
 * in the browser UI (background notes, internal flags, status updates via API).
 *
 * Endpoint patterns are derived from the dispatch-new Lambda API structure.
 * All requests include a Sisyphus context header for traceability.
 *
 * @see planning/11-ontology-data-mapping.md section 2 (Write Path)
 * @see planning/09-ontology-layer-design.md section 8.2
 */

import { createChildLogger } from "../../lib/logger.js";

const log = createChildLogger("execution:api:client");

/** Standard response shape from the API writer methods. */
export interface ApiWriteResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export class DispatchApiWriter {
  private readonly baseUrl: string;
  private readonly authToken: string;

  constructor(baseUrl: string, authToken: string) {
    // Strip trailing slash for consistent URL construction
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.authToken = authToken;
  }

  // -------------------------------------------------------------------------
  // Order endpoints
  // -------------------------------------------------------------------------

  /**
   * Update the status of an order.
   * POST /orders/{orderId}/status
   */
  async updateOrderStatus(orderId: string, status: string): Promise<ApiWriteResult> {
    return this.post(`/orders/${orderId}/status`, { status });
  }

  /**
   * Assign a driver to an order.
   * POST /orders/{orderId}/assign-driver
   *
   * Note: driverId is an email address in ValleyEats (not a UUID).
   */
  async assignDriver(orderId: string, driverId: string): Promise<ApiWriteResult> {
    return this.post(`/orders/${orderId}/assign-driver`, { driverId });
  }

  // -------------------------------------------------------------------------
  // Messaging endpoints
  // -------------------------------------------------------------------------

  /**
   * Send a message to a driver.
   * POST /messages/{driverId}
   *
   * @param driverId  - Driver's email address
   * @param message   - Message content
   * @param attach    - Optional attachment metadata
   */
  async sendMessage(
    driverId: string,
    message: string,
    attach?: unknown,
  ): Promise<ApiWriteResult> {
    const body: Record<string, unknown> = { message };
    if (attach !== undefined) {
      body.attachment = attach;
    }
    return this.post(`/messages/${encodeURIComponent(driverId)}`, body);
  }

  /**
   * Mark a driver's conversation as read.
   * POST /messages/{driverId}/read
   */
  async markConversationRead(driverId: string): Promise<ApiWriteResult> {
    return this.post(`/messages/${encodeURIComponent(driverId)}/read`, {});
  }

  // -------------------------------------------------------------------------
  // Support / issue-tracker endpoints
  // -------------------------------------------------------------------------

  /**
   * Update the status of a support issue.
   * POST /support/issues/{issueId}/status
   */
  async updateIssueStatus(issueId: string, status: string): Promise<ApiWriteResult> {
    return this.post(`/support/issues/${issueId}/status`, { status });
  }

  /**
   * Assign or change the owner of a support issue.
   * POST /support/issues/{issueId}/owner
   */
  async updateIssueOwner(issueId: string, owner: string): Promise<ApiWriteResult> {
    return this.post(`/support/issues/${issueId}/owner`, { owner });
  }

  /**
   * Add an internal note to a support issue.
   * POST /support/issues/{issueId}/note
   */
  async addIssueNote(issueId: string, note: string): Promise<ApiWriteResult> {
    return this.post(`/support/issues/${issueId}/note`, { note });
  }

  // -------------------------------------------------------------------------
  // Internal HTTP helper
  // -------------------------------------------------------------------------

  /**
   * Send a POST request to the dispatch API with standard headers.
   */
  private async post(path: string, body: Record<string, unknown>): Promise<ApiWriteResult> {
    const url = `${this.baseUrl}${path}`;
    log.debug({ url, body }, "API POST request");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.authToken}`,
          // Sisyphus context headers for traceability in dispatch API logs
          "X-Sisyphus-Agent": "sisyphus",
          "X-Sisyphus-Version": "0.1.0",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        log.warn(
          { url, status: response.status, errorText },
          "API request failed with non-OK status",
        );
        return {
          success: false,
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

      // Try to parse JSON response; some endpoints may return empty bodies
      let data: unknown;
      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      log.debug({ url, status: response.status }, "API request succeeded");
      return { success: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ url, error: message }, "API request threw an exception");
      return { success: false, error: message };
    }
  }
}
