/**
 * Dispatch REST API client.
 *
 * Wraps HTTP calls to the dispatch-new Lambda API. Uses Node 22's built-in
 * fetch — no additional HTTP library required.
 *
 * All methods return raw (untyped) data. The transformer layer shapes them
 * into typed ontology objects.
 */

import type { Logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchApiClientOptions {
  baseUrl: string;
  authToken: string;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// DispatchApiClient
// ---------------------------------------------------------------------------

export class DispatchApiClient {
  private readonly baseUrl: string;
  private readonly authToken: string;
  private readonly log: Logger;

  constructor(opts: DispatchApiClientOptions) {
    // Strip trailing slash so we can safely append paths
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.authToken = opts.authToken;
    this.log = opts.logger;
  }

  // ---- Public fetch methods -------------------------------------------------

  /** GET /orders — active order list */
  async fetchOrders(): Promise<any[]> {
    return this.getArray("/orders");
  }

  /** GET /drivers — driver roster */
  async fetchDrivers(): Promise<any[]> {
    return this.getArray("/drivers");
  }

  /** GET /support/issues — support tickets (optionally filtered by status) */
  async fetchIssues(status?: string): Promise<any[]> {
    const path = status ? `/support/issues?status=${encodeURIComponent(status)}` : "/support/issues";
    return this.getArray(path);
  }

  /** GET /messages/conversations — latest-message cache for all drivers */
  async fetchConversations(): Promise<any[]> {
    return this.getArray("/messages/conversations");
  }

  /** GET /messages/{driverId} — full message history for a single driver */
  async fetchMessages(driverId: string): Promise<any[]> {
    return this.getArray(`/messages/${encodeURIComponent(driverId)}`);
  }

  /** GET /dispatch — S3-backed dispatch snapshot (market state) */
  async fetchDispatchSnapshot(): Promise<any> {
    return this.getJson("/dispatch");
  }

  /** GET /insights — AI decision log */
  async fetchInsights(): Promise<any[]> {
    return this.getArray("/insights");
  }

  /** GET /dispatch/meters — per-market demand meters */
  async fetchMarketMeters(): Promise<any[]> {
    return this.getArray("/dispatch/meters");
  }

  // ---- Internal helpers -----------------------------------------------------

  /**
   * Execute a GET request and return the parsed JSON body.
   * Returns the body as-is (object or array).
   */
  private async getJson(path: string): Promise<any> {
    const url = `${this.baseUrl}${path}`;

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          Accept: "application/json",
          "x-dispatch-agent": "sisyphus",
        },
      });

      if (!res.ok) {
        this.log.warn(
          { status: res.status, statusText: res.statusText, url },
          `Dispatch API request failed: ${res.status} ${res.statusText}`,
        );
        return null;
      }

      const body = await res.json();
      return body;
    } catch (err) {
      this.log.error(
        { err, url },
        `Dispatch API request error: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Execute a GET request and guarantee an array response.
   *
   * If the response body is an object with a single array-valued property
   * (common pattern for paginated/envelope responses), unwrap it automatically.
   * Falls back to an empty array on any error.
   */
  private async getArray(path: string): Promise<any[]> {
    const body = await this.getJson(path);

    if (body == null) return [];
    if (Array.isArray(body)) return body;

    // Attempt to unwrap envelope: { "orders": [...] } or { "data": [...] }
    if (typeof body === "object") {
      const keys = Object.keys(body);
      for (const key of keys) {
        if (Array.isArray(body[key])) {
          return body[key];
        }
      }
    }

    this.log.warn({ path, bodyType: typeof body }, "Unexpected non-array response from dispatch API");
    return [];
  }
}
