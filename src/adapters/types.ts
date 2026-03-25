/**
 * Dispatch adapter interfaces.
 *
 * Abstracts the dispatch system so that Sisyphus agent logic, ontology sync,
 * and action execution never know whether they are talking to the old PHP
 * dispatch (dispatch.valleyeats.ca) or the new React/AWS dispatch.
 *
 * Implementations live in `old-dispatch/` and `new-dispatch/` sub-modules.
 */

import type { Page } from "playwright";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/** Standard result shape returned by all write operations. */
export interface ApiResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Adapter discriminant
// ---------------------------------------------------------------------------

export type AdapterType = "old-dispatch" | "new-dispatch";

// ---------------------------------------------------------------------------
// DispatchAdapter — the unified interface every consumer depends on
// ---------------------------------------------------------------------------

export interface DispatchAdapter {
  /** Human-readable label for logging. */
  readonly name: string;

  // -- Auth ----------------------------------------------------------------

  /** Perform browser-based login (Cognito redirect, form fill, etc.). */
  login(page: Page): Promise<void>;

  /**
   * Extract session / auth cookies from the authenticated browser context.
   * Returns a cookie string suitable for the `Cookie` HTTP header.
   */
  getSessionCookies(page: Page): Promise<string>;

  // -- Read operations (ontology sync) -------------------------------------

  fetchActiveOrders(zone?: string): Promise<any[]>;
  fetchDrivers(zone?: string): Promise<any[]>;
  fetchIssues(zone?: string, status?: string): Promise<any[]>;
  fetchOrderDetails(orderId: string): Promise<any>;
  fetchCustomerDetails(email: string): Promise<any>;
  fetchDriverDetails(driverId: string): Promise<any>;
  fetchMarketState(): Promise<any>;

  // -- Write operations (action execution) ---------------------------------

  changeOrderStatus(orderId: string, status: string): Promise<ApiResult>;
  assignDriver(orderId: string, driverId: string, reason?: string): Promise<ApiResult>;
  sendDriverMessage(driverId: string, message: string): Promise<ApiResult>;
  addIssueMessage(issueId: string, message: string): Promise<ApiResult>;
  sendCustomerNotification(orderId: string, message: string): Promise<ApiResult>;
}

// ---------------------------------------------------------------------------
// OntologySyncSource — minimal read interface for the OntologySyncer
// ---------------------------------------------------------------------------

/**
 * Subset of DispatchAdapter that the OntologySyncer needs.
 *
 * Both `DispatchApiClient` (new dispatch) and `DispatchAdapter` satisfy this
 * interface, so the syncer can work with either without any changes.
 */
export interface OntologySyncSource {
  fetchOrders(zone?: string): Promise<any[]>;
  fetchDrivers(zone?: string): Promise<any[]>;
  fetchIssues(status?: string): Promise<any[]>;
  fetchConversations?(): Promise<any[]>;
  fetchDispatchSnapshot?(): Promise<any>;
  fetchMarketMeters?(): Promise<any[]>;
  fetchMarketState?(): Promise<any>;
}
