/**
 * New dispatch adapter — thin wrapper around existing clients.
 *
 * Maps the unified `DispatchAdapter` interface to the existing
 * `DispatchApiClient` (reads) and `DispatchApiWriter` (writes) that were
 * built for the new React/AWS dispatch system.
 *
 * @see src/ontology/sync/dispatch-api.ts  — DispatchApiClient (reads)
 * @see src/execution/api/client.ts        — DispatchApiWriter (writes)
 */

import type { Page } from "playwright";
import { createChildLogger } from "../../lib/logger.js";
import { DispatchApiClient } from "../../ontology/sync/dispatch-api.js";
import { DispatchApiWriter } from "../../execution/api/client.js";
import { authenticateDispatch } from "../../execution/browser/auth.js";
import type { DispatchAdapter, ApiResult } from "../types.js";

const log = createChildLogger("adapters:new-dispatch:client");

// ---------------------------------------------------------------------------
// NewDispatchClient
// ---------------------------------------------------------------------------

export class NewDispatchClient implements DispatchAdapter {
  readonly name = "new-dispatch";

  private readonly reader: DispatchApiClient;
  private readonly writer: DispatchApiWriter;

  private readonly dispatchUrl: string;
  private readonly username: string;
  private readonly password: string;

  constructor(opts: {
    baseUrl: string;
    authToken: string;
    dispatchUrl: string;
    username: string;
    password: string;
  }) {
    this.reader = new DispatchApiClient({
      baseUrl: opts.baseUrl,
      authToken: opts.authToken,
      logger: log,
    });
    this.writer = new DispatchApiWriter(opts.baseUrl, opts.authToken);
    this.dispatchUrl = opts.dispatchUrl;
    this.username = opts.username;
    this.password = opts.password;
  }

  // -- Auth ----------------------------------------------------------------

  async login(page: Page): Promise<void> {
    await authenticateDispatch(page, this.dispatchUrl, this.username, this.password);
    log.info("New dispatch authentication successful");
  }

  async getSessionCookies(page: Page): Promise<string> {
    // New dispatch uses Bearer tokens, not session cookies.
    // Return an empty string — the API clients use their own auth header.
    const cookies = await page.context().cookies();
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  // -- Read operations -----------------------------------------------------

  async fetchActiveOrders(_zone?: string): Promise<any[]> {
    // The new dispatch API does not support per-zone filtering at the API
    // level; the syncer handles filtering in the ontology layer.
    return this.reader.fetchOrders();
  }

  async fetchDrivers(_zone?: string): Promise<any[]> {
    return this.reader.fetchDrivers();
  }

  async fetchIssues(_zone?: string, status?: string): Promise<any[]> {
    return this.reader.fetchIssues(status);
  }

  async fetchOrderDetails(orderId: string): Promise<any> {
    // The new dispatch does not expose a single-order endpoint in the
    // current client — fall back to fetching all orders and filtering.
    const orders = await this.reader.fetchOrders();
    return orders.find((o: any) => o.OrderId === orderId) ?? null;
  }

  async fetchCustomerDetails(_email: string): Promise<any> {
    // Not yet exposed via the new dispatch REST API.
    log.warn("fetchCustomerDetails not available in new-dispatch adapter");
    return null;
  }

  async fetchDriverDetails(driverId: string): Promise<any> {
    // Fall back to the full driver list and filter.
    const drivers = await this.reader.fetchDrivers();
    return drivers.find((d: any) => d.DriverId === driverId) ?? null;
  }

  async fetchMarketState(): Promise<any> {
    return this.reader.fetchDispatchSnapshot();
  }

  // -- Write operations ----------------------------------------------------

  async changeOrderStatus(orderId: string, status: string): Promise<ApiResult> {
    const result = await this.writer.updateOrderStatus(orderId, status);
    return { success: result.success, data: result.data, error: result.error };
  }

  async assignDriver(
    orderId: string,
    driverId: string,
    _reason?: string,
  ): Promise<ApiResult> {
    // The new dispatch writer doesn't support a reason field for assignment.
    const result = await this.writer.assignDriver(orderId, driverId);
    return { success: result.success, data: result.data, error: result.error };
  }

  async sendDriverMessage(driverId: string, message: string): Promise<ApiResult> {
    const result = await this.writer.sendMessage(driverId, message);
    return { success: result.success, data: result.data, error: result.error };
  }

  async addIssueMessage(issueId: string, message: string): Promise<ApiResult> {
    const result = await this.writer.addIssueNote(issueId, message);
    return { success: result.success, data: result.data, error: result.error };
  }

  async sendCustomerNotification(
    _orderId: string,
    _message: string,
  ): Promise<ApiResult> {
    // Not yet exposed via the new dispatch API writer.
    log.warn("sendCustomerNotification not available in new-dispatch adapter");
    return { success: false, error: "Not implemented in new-dispatch adapter" };
  }

  // -- OntologySyncSource compatibility ------------------------------------

  /** Alias for ontology syncer compatibility. */
  async fetchOrders(zone?: string): Promise<any[]> {
    return this.fetchActiveOrders(zone);
  }

  async fetchConversations(): Promise<any[]> {
    return this.reader.fetchConversations();
  }

  async fetchDispatchSnapshot(): Promise<any> {
    return this.reader.fetchDispatchSnapshot();
  }

  async fetchMarketMeters(): Promise<any[]> {
    return this.reader.fetchMarketMeters();
  }
}
