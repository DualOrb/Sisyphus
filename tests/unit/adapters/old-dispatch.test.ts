/**
 * Unit tests for the old dispatch adapter layer.
 *
 * Covers:
 * - OldDispatchClient builds correct form-encoded POST requests
 * - Session cookie is included in all requests
 * - Error handling returns ApiResult with success=false
 * - extractSessionCookie returns the right cookie string
 * - Factory creates the correct adapter type based on config
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { OldDispatchClient } from "@/adapters/old-dispatch/client";
import { extractSessionCookie } from "@/adapters/old-dispatch/auth";
import {
  createDispatchAdapter,
  createDispatchAdapterFromEnv,
} from "@/adapters/factory";
import type { AdapterConfig } from "@/adapters/factory";

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

function errorResponse(status: number, body = "Server Error"): Response {
  return {
    ok: false,
    status,
    statusText: "Error",
    headers: new Headers({ "Content-Type": "text/plain" }),
    json: () => Promise.reject(new Error("Not JSON")),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// OldDispatchClient — request building
// ---------------------------------------------------------------------------

describe("OldDispatchClient", () => {
  let client: OldDispatchClient;

  const BASE_URL = "https://dispatch.valleyeats.ca";
  const SESSION_COOKIE = "PHPSESSID=abc123def456";

  beforeEach(() => {
    mockFetch.mockReset();
    client = new OldDispatchClient({
      baseUrl: BASE_URL,
      sessionCookie: SESSION_COOKIE,
      username: "test@valleyeats.ca",
      password: "secret",
    });
  });

  // -----------------------------------------------------------------------
  // Form-encoded POST requests
  // -----------------------------------------------------------------------

  describe("request building", () => {
    it("sends POST with form-encoded body to fetchActiveOrders", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      await client.fetchActiveOrders("Perth");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];

      expect(url).toBe(`${BASE_URL}/post/builddispatchcache.php`);
      expect(opts.method).toBe("POST");
      expect(opts.headers["Content-Type"]).toBe(
        "application/x-www-form-urlencoded",
      );
      expect(opts.body).toBe("zone=Perth");
    });

    it("sends POST to builddriverselect.php for fetchDrivers", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      await client.fetchDrivers("Pembroke");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/post/builddriverselect.php`);
      expect(opts.body).toBe("zone=Pembroke");
    });

    it("sends POST to buildissuerows.php for fetchIssues", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      await client.fetchIssues("Perth", "open");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/post/buildissuerows.php`);
      expect(opts.body).toContain("zone=Perth");
      expect(opts.body).toContain("status=open");
    });

    it("sends OrderId to getadminorder.php for fetchOrderDetails", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ OrderId: "order-1" }));

      await client.fetchOrderDetails("order-1");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/post/getadminorder.php`);
      expect(opts.body).toBe("OrderId=order-1");
    });

    it("sends email to getadmincustomer.php for fetchCustomerDetails", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ email: "joe@test.com" }));

      await client.fetchCustomerDetails("joe@test.com");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/post/getadmincustomer.php`);
      expect(opts.body).toContain("email=joe%40test.com");
    });

    it("sends DriverId to getadmindriver.php for fetchDriverDetails", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ DriverId: "d1" }));

      await client.fetchDriverDetails("d1");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/post/getadmindriver.php`);
      expect(opts.body).toBe("DriverId=d1");
    });

    it("omits empty optional params", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      await client.fetchActiveOrders(); // no zone

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.body).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // Session cookie
  // -----------------------------------------------------------------------

  describe("session cookie", () => {
    it("includes the session cookie in all requests", async () => {
      mockFetch.mockResolvedValue(jsonResponse([]));

      await client.fetchActiveOrders();
      await client.fetchDrivers();
      await client.changeOrderStatus("o1", "Completed");

      for (const call of mockFetch.mock.calls) {
        const opts = call[1];
        expect(opts.headers.Cookie).toBe(SESSION_COOKIE);
      }
    });

    it("includes X-Sisyphus-Agent header", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      await client.fetchActiveOrders();

      const opts = mockFetch.mock.calls[0][1];
      expect(opts.headers["X-Sisyphus-Agent"]).toBe("sisyphus");
    });

    it("allows updating the session cookie", async () => {
      mockFetch.mockResolvedValue(jsonResponse([]));

      client.setSessionCookie("PHPSESSID=newcookie789");
      await client.fetchActiveOrders();

      const opts = mockFetch.mock.calls[0][1];
      expect(opts.headers.Cookie).toBe("PHPSESSID=newcookie789");
    });
  });

  // -----------------------------------------------------------------------
  // Write operations
  // -----------------------------------------------------------------------

  describe("write operations", () => {
    it("changeOrderStatus calls changeorderstatus.php", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      const result = await client.changeOrderStatus("order-1", "Completed");

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ ok: true });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/post/changeorderstatus.php`);
      expect(opts.body).toContain("OrderId=order-1");
      expect(opts.body).toContain("status=Completed");
    });

    it("assignDriver calls changedriver.php with reason", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      const result = await client.assignDriver("o1", "d1", "closer to restaurant");

      expect(result.success).toBe(true);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/post/changedriver.php`);
      expect(opts.body).toContain("OrderId=o1");
      expect(opts.body).toContain("DriverId=d1");
      expect(opts.body).toContain("reason=closer+to+restaurant");
    });

    it("sendDriverMessage calls senddriverchat.php", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      const result = await client.sendDriverMessage("d1", "Hello driver");

      expect(result.success).toBe(true);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/post/senddriverchat.php`);
      expect(opts.body).toContain("DriverId=d1");
      expect(opts.body).toContain("message=Hello+driver");
    });

    it("addIssueMessage calls addmessage.php", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      const result = await client.addIssueMessage("iss-1", "Working on it");

      expect(result.success).toBe(true);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/post/addmessage.php`);
    });

    it("sendCustomerNotification calls sendordernotification.php", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      const result = await client.sendCustomerNotification(
        "o1",
        "Your order is on its way",
      );

      expect(result.success).toBe(true);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/post/sendordernotification.php`);
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe("error handling", () => {
    it("returns ApiResult with success=false on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(500, "Internal Server Error"));

      const result = await client.changeOrderStatus("o1", "Cancelled");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns empty array on HTTP error for read operations", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(500));

      const orders = await client.fetchActiveOrders();

      expect(orders).toEqual([]);
    });

    it("returns ApiResult with success=false on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await client.assignDriver("o1", "d1");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      // The internal post() catches the error and returns null,
      // which postAction() converts to a generic failure message.
      expect(typeof result.error).toBe("string");
    });

    it("returns null on network error for detail endpoints", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const details = await client.fetchOrderDetails("o1");

      expect(details).toBeNull();
    });

    it("handles non-JSON response body gracefully", async () => {
      const htmlResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ "Content-Type": "text/html" }),
        text: () => Promise.resolve("<html>Not JSON</html>"),
      } as unknown as Response;

      mockFetch.mockResolvedValueOnce(htmlResponse);

      const data = await client.fetchOrderDetails("o1");
      expect(data).toBe("<html>Not JSON</html>");
    });
  });

  // -----------------------------------------------------------------------
  // Array normalisation
  // -----------------------------------------------------------------------

  describe("array normalisation", () => {
    it("unwraps envelope responses", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ orders: [{ id: 1 }, { id: 2 }] }),
      );

      const orders = await client.fetchActiveOrders();

      expect(orders).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("returns raw array as-is", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 1 }]));

      const orders = await client.fetchActiveOrders();

      expect(orders).toEqual([{ id: 1 }]);
    });
  });
});

// ---------------------------------------------------------------------------
// extractSessionCookie
// ---------------------------------------------------------------------------

describe("extractSessionCookie", () => {
  it("returns the formatted cookie string", async () => {
    const mockPage = {
      url: () => "https://dispatch.valleyeats.ca/dispatch",
      context: () => ({
        cookies: () =>
          Promise.resolve([
            {
              name: "PHPSESSID",
              value: "abc123",
              domain: "dispatch.valleyeats.ca",
              path: "/",
            },
            {
              name: "tracking",
              value: "xyz",
              domain: ".valleyeats.ca",
              path: "/",
            },
          ]),
      }),
    } as any;

    const cookie = await extractSessionCookie(mockPage);

    expect(cookie).toContain("PHPSESSID=abc123");
    expect(cookie).toContain("tracking=xyz");
    expect(cookie).toContain("; ");
  });

  it("returns empty string when no cookies found", async () => {
    const mockPage = {
      url: () => "https://dispatch.valleyeats.ca/dispatch",
      context: () => ({
        cookies: () => Promise.resolve([]),
      }),
    } as any;

    const cookie = await extractSessionCookie(mockPage);

    expect(cookie).toBe("");
  });

  it("filters out cookies from unrelated domains", async () => {
    const mockPage = {
      url: () => "https://dispatch.valleyeats.ca/dispatch",
      context: () => ({
        cookies: () =>
          Promise.resolve([
            {
              name: "PHPSESSID",
              value: "abc123",
              domain: "dispatch.valleyeats.ca",
              path: "/",
            },
            {
              name: "other",
              value: "nope",
              domain: "some-other-site.com",
              path: "/",
            },
          ]),
      }),
    } as any;

    const cookie = await extractSessionCookie(mockPage);

    expect(cookie).toBe("PHPSESSID=abc123");
    expect(cookie).not.toContain("other");
  });
});

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

describe("createDispatchAdapter", () => {
  it("creates an OldDispatchClient for type old-dispatch", () => {
    const config: AdapterConfig = {
      type: "old-dispatch",
      config: {
        baseUrl: "https://dispatch.valleyeats.ca",
        username: "test@valleyeats.ca",
        password: "secret",
      },
    };

    const adapter = createDispatchAdapter(config);

    expect(adapter.name).toBe("old-dispatch");
  });

  it("creates a NewDispatchClient for type new-dispatch", () => {
    const config: AdapterConfig = {
      type: "new-dispatch",
      config: {
        baseUrl: "https://api.valleyeats.ca",
        authToken: "token123",
        dispatchUrl: "https://dispatch-new.valleyeats.ca",
        username: "test@valleyeats.ca",
        password: "secret",
      },
    };

    const adapter = createDispatchAdapter(config);

    expect(adapter.name).toBe("new-dispatch");
  });
});

describe("createDispatchAdapterFromEnv", () => {
  it("defaults to old-dispatch when DISPATCH_ADAPTER is not set", () => {
    const adapter = createDispatchAdapterFromEnv({
      DISPATCH_API_URL: "https://dispatch.valleyeats.ca",
      DISPATCH_USERNAME: "test@valleyeats.ca",
      DISPATCH_PASSWORD: "secret",
    });

    expect(adapter.name).toBe("old-dispatch");
  });

  it("creates old-dispatch when explicitly specified", () => {
    const adapter = createDispatchAdapterFromEnv({
      DISPATCH_ADAPTER: "old-dispatch",
      DISPATCH_API_URL: "https://dispatch.valleyeats.ca",
      DISPATCH_USERNAME: "test@valleyeats.ca",
      DISPATCH_PASSWORD: "secret",
    });

    expect(adapter.name).toBe("old-dispatch");
  });

  it("creates new-dispatch when specified", () => {
    const adapter = createDispatchAdapterFromEnv({
      DISPATCH_ADAPTER: "new-dispatch",
      DISPATCH_API_URL: "https://api.valleyeats.ca",
      DISPATCH_USERNAME: "test@valleyeats.ca",
      DISPATCH_PASSWORD: "secret",
    });

    expect(adapter.name).toBe("new-dispatch");
  });

  it("throws on unknown adapter type", () => {
    expect(() =>
      createDispatchAdapterFromEnv({
        DISPATCH_ADAPTER: "invalid-type",
        DISPATCH_API_URL: "https://dispatch.valleyeats.ca",
        DISPATCH_USERNAME: "test@valleyeats.ca",
        DISPATCH_PASSWORD: "secret",
      }),
    ).toThrow("Unknown DISPATCH_ADAPTER value");
  });
});
