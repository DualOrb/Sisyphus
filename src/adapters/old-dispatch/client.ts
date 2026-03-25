/**
 * Old dispatch API client.
 *
 * Talks to the PHP backend at dispatch.valleyeats.ca via POST requests to
 * `/post/*.php` endpoints. Authentication is handled by a PHP session cookie
 * obtained from the browser after Cognito login.
 *
 * All request bodies are `application/x-www-form-urlencoded` (PHP expects
 * form data, not JSON).
 *
 * @see planning/12-old-dispatch-discovery.md
 */

import type { Page } from "playwright";
import { createChildLogger } from "../../lib/logger.js";
import type { DispatchAdapter, ApiResult } from "../types.js";
import { authenticateOldDispatch, extractSessionCookie } from "./auth.js";

const log = createChildLogger("adapters:old-dispatch:client");

// ---------------------------------------------------------------------------
// OldDispatchClient
// ---------------------------------------------------------------------------

export class OldDispatchClient implements DispatchAdapter {
  readonly name = "old-dispatch";

  private readonly baseUrl: string;
  private sessionCookie: string;

  private readonly username: string;
  private readonly password: string;

  constructor(opts: {
    baseUrl: string;
    sessionCookie?: string;
    username: string;
    password: string;
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.sessionCookie = opts.sessionCookie ?? "";
    this.username = opts.username;
    this.password = opts.password;
  }

  // -- Auth ----------------------------------------------------------------

  async login(page: Page): Promise<void> {
    await authenticateOldDispatch(page, this.baseUrl, this.username, this.password);
    this.sessionCookie = await extractSessionCookie(page);
    log.info("Login complete — session cookie captured");
  }

  async getSessionCookies(page: Page): Promise<string> {
    const cookie = await extractSessionCookie(page);
    this.sessionCookie = cookie;
    return cookie;
  }

  /** Allow callers to update the session cookie without a browser reference. */
  setSessionCookie(cookie: string): void {
    this.sessionCookie = cookie;
  }

  // -- Read operations -----------------------------------------------------

  async fetchActiveOrders(zone?: string): Promise<any[]> {
    const params: Record<string, string> = {};
    if (zone) params.zone = zone;
    const data = await this.post("/post/builddispatchcache.php", params);
    return this.toArray(data);
  }

  async fetchDrivers(zone?: string): Promise<any[]> {
    const params: Record<string, string> = {};
    if (zone) params.zone = zone;
    const data = await this.post("/post/builddriverselect.php", params);
    return this.toArray(data);
  }

  async fetchIssues(zone?: string, status?: string): Promise<any[]> {
    const params: Record<string, string> = {};
    if (zone) params.zone = zone;
    if (status) params.status = status;
    const data = await this.post("/post/buildissuerows.php", params);
    return this.toArray(data);
  }

  async fetchOrderDetails(orderId: string): Promise<any> {
    return this.post("/post/getadminorder.php", { OrderId: orderId });
  }

  async fetchCustomerDetails(email: string): Promise<any> {
    return this.post("/post/getadmincustomer.php", { email });
  }

  async fetchDriverDetails(driverId: string): Promise<any> {
    return this.post("/post/getadmindriver.php", { DriverId: driverId });
  }

  async fetchMarketState(): Promise<any> {
    // The old dispatch doesn't have a single "market state" endpoint.
    // Fetch the dispatch cache which contains orders + drivers per zone.
    return this.post("/post/builddispatchcache.php", {});
  }

  // -- Write operations ----------------------------------------------------

  async changeOrderStatus(orderId: string, status: string): Promise<ApiResult> {
    return this.postAction("/post/changeorderstatus.php", {
      OrderId: orderId,
      status,
    });
  }

  async assignDriver(
    orderId: string,
    driverId: string,
    reason?: string,
  ): Promise<ApiResult> {
    const params: Record<string, string> = {
      OrderId: orderId,
      DriverId: driverId,
    };
    if (reason) params.reason = reason;
    return this.postAction("/post/changedriver.php", params);
  }

  async sendDriverMessage(driverId: string, message: string): Promise<ApiResult> {
    return this.postAction("/post/senddriverchat.php", {
      DriverId: driverId,
      message,
    });
  }

  async addIssueMessage(issueId: string, message: string): Promise<ApiResult> {
    return this.postAction("/post/addmessage.php", {
      IssueId: issueId,
      message,
    });
  }

  async sendCustomerNotification(
    orderId: string,
    message: string,
  ): Promise<ApiResult> {
    return this.postAction("/post/sendordernotification.php", {
      OrderId: orderId,
      message,
    });
  }

  // -- OntologySyncSource compatibility ------------------------------------

  /** Alias so this client satisfies `OntologySyncSource.fetchOrders`. */
  async fetchOrders(zone?: string): Promise<any[]> {
    return this.fetchActiveOrders(zone);
  }

  // -- Internal helpers ----------------------------------------------------

  /**
   * Send a POST request to a PHP endpoint with form-encoded body.
   * Returns the parsed response body (JSON when possible, raw text otherwise).
   */
  private async post(
    path: string,
    params: Record<string, string>,
  ): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const body = new URLSearchParams(params).toString();

    log.debug({ url, params }, "POST request");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: this.sessionCookie,
          "X-Sisyphus-Agent": "sisyphus",
        },
        body,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        log.warn(
          { url, status: response.status, errorText },
          "PHP endpoint returned non-OK status",
        );
        return null;
      }

      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/json")) {
        return response.json();
      }

      // The old dispatch sometimes returns HTML or plain text.
      // Try to parse as JSON anyway; fall back to raw text.
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ url, error: message }, "POST request threw an exception");
      return null;
    }
  }

  /**
   * Write-operation variant — wraps the raw POST and returns an ApiResult.
   */
  private async postAction(
    path: string,
    params: Record<string, string>,
  ): Promise<ApiResult> {
    try {
      const data = await this.post(path, params);
      if (data === null) {
        return { success: false, error: "Request failed or returned non-OK status" };
      }
      return { success: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * Normalise a response to an array. Many old-dispatch endpoints return
   * objects with a single array property, or raw arrays.
   */
  private toArray(data: any): any[] {
    if (data == null) return [];
    if (Array.isArray(data)) return data;

    if (typeof data === "object") {
      const keys = Object.keys(data);
      for (const key of keys) {
        if (Array.isArray(data[key])) {
          return data[key];
        }
      }
    }

    log.warn({ dataType: typeof data }, "Unexpected non-array response from old dispatch");
    return [];
  }
}
