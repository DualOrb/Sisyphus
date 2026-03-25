/**
 * Unit tests for old dispatch API response transformers.
 *
 * Tests cover:
 * - parseDispatchCache: splitting the cache blob into typed arrays
 * - parseIssueRows: extracting structured data from HTML data attributes
 * - parseOrderDetails: unwrapping DynamoDB wire format + PHP normalisation
 * - parseDriverDetails: unwrapping DynamoDB wire format + PHP normalisation
 * - unwrapDynamoValue / unwrapDynamoItem: DynamoDB type unwrapping
 * - normalisePhpValue / normalisePhpObject: PHP quirk normalisation
 * - cacheIdToDriverEmail / driverEmailToCacheId: ID format conversion
 */

import { describe, it, expect } from "vitest";
import {
  parseDispatchCache,
  parseIssueRows,
  parseOrderDetails,
  parseDriverDetails,
  unwrapDynamoValue,
  unwrapDynamoItem,
  normalisePhpValue,
  normalisePhpObject,
  cacheIdToDriverEmail,
  driverEmailToCacheId,
} from "@/adapters/old-dispatch/transformer";

// ---------------------------------------------------------------------------
// DynamoDB unwrapping
// ---------------------------------------------------------------------------

describe("unwrapDynamoValue", () => {
  it("unwraps string type (S)", () => {
    expect(unwrapDynamoValue({ S: "hello" })).toBe("hello");
  });

  it("unwraps number type (N) from string", () => {
    expect(unwrapDynamoValue({ N: "42" })).toBe(42);
  });

  it("unwraps number type (N) from number", () => {
    expect(unwrapDynamoValue({ N: 42 })).toBe(42);
  });

  it("unwraps boolean type (BOOL)", () => {
    expect(unwrapDynamoValue({ BOOL: true })).toBe(true);
    expect(unwrapDynamoValue({ BOOL: false })).toBe(false);
  });

  it("unwraps null type (NULL)", () => {
    expect(unwrapDynamoValue({ NULL: true })).toBe(null);
  });

  it("unwraps list type (L)", () => {
    expect(
      unwrapDynamoValue({ L: [{ S: "a" }, { S: "b" }, { N: "3" }] }),
    ).toEqual(["a", "b", 3]);
  });

  it("unwraps map type (M)", () => {
    expect(
      unwrapDynamoValue({
        M: { name: { S: "test" }, count: { N: "5" } },
      }),
    ).toEqual({ name: "test", count: 5 });
  });

  it("unwraps nested structures", () => {
    const input = {
      M: {
        items: {
          L: [
            { M: { id: { S: "a" }, price: { N: "100" } } },
            { M: { id: { S: "b" }, price: { N: "200" } } },
          ],
        },
        active: { BOOL: true },
      },
    };
    expect(unwrapDynamoValue(input)).toEqual({
      items: [
        { id: "a", price: 100 },
        { id: "b", price: 200 },
      ],
      active: true,
    });
  });

  it("passes through plain values", () => {
    expect(unwrapDynamoValue("hello")).toBe("hello");
    expect(unwrapDynamoValue(42)).toBe(42);
    expect(unwrapDynamoValue(true)).toBe(true);
    expect(unwrapDynamoValue(null)).toBe(null);
    expect(unwrapDynamoValue(undefined)).toBe(null);
  });
});

describe("unwrapDynamoItem", () => {
  it("unwraps a full DynamoDB item", () => {
    const item = {
      OrderId: { S: "abc-123" },
      OrderStatus: { S: "Pending" },
      OrderTotal: { N: "4500" },
      ASAP: { BOOL: true },
      OrderItems: {
        L: [
          {
            M: {
              ItemName: { S: "Pizza" },
              Price: { N: "1500" },
              Quantity: { N: "1" },
            },
          },
        ],
      },
    };

    const result = unwrapDynamoItem(item);
    expect(result).toEqual({
      OrderId: "abc-123",
      OrderStatus: "Pending",
      OrderTotal: 4500,
      ASAP: true,
      OrderItems: [
        { ItemName: "Pizza", Price: 1500, Quantity: 1 },
      ],
    });
  });

  it("handles empty item", () => {
    expect(unwrapDynamoItem({})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// PHP normalisation
// ---------------------------------------------------------------------------

describe("normalisePhpValue", () => {
  it("converts 'true' string to boolean true", () => {
    expect(normalisePhpValue("true")).toBe(true);
  });

  it("converts 'false' string to boolean false", () => {
    expect(normalisePhpValue("false")).toBe(false);
  });

  it("converts 'null' string to null", () => {
    expect(normalisePhpValue("null")).toBe(null);
  });

  it("passes through actual booleans", () => {
    expect(normalisePhpValue(true)).toBe(true);
    expect(normalisePhpValue(false)).toBe(false);
  });

  it("passes through numbers", () => {
    expect(normalisePhpValue(42)).toBe(42);
    expect(normalisePhpValue(0)).toBe(0);
  });

  it("passes through regular strings", () => {
    expect(normalisePhpValue("hello")).toBe("hello");
    expect(normalisePhpValue("Pending")).toBe("Pending");
  });

  it("converts empty string to null when emptyToNull is true", () => {
    expect(normalisePhpValue("", { emptyToNull: true })).toBe(null);
  });

  it("keeps empty string when emptyToNull is false", () => {
    expect(normalisePhpValue("")).toBe("");
    expect(normalisePhpValue("", { emptyToNull: false })).toBe("");
  });

  it("handles null and undefined", () => {
    expect(normalisePhpValue(null)).toBe(null);
    expect(normalisePhpValue(undefined)).toBe(undefined);
  });
});

describe("normalisePhpObject", () => {
  it("recursively normalises an object", () => {
    const input = {
      active: "true",
      deleted: "false",
      name: "Test",
      nested: {
        value: "null",
        count: 5,
      },
    };

    expect(normalisePhpObject(input)).toEqual({
      active: true,
      deleted: false,
      name: "Test",
      nested: {
        value: null,
        count: 5,
      },
    });
  });

  it("normalises arrays", () => {
    const input = ["true", "false", "null", "hello", 42];
    expect(normalisePhpObject(input)).toEqual([true, false, null, "hello", 42]);
  });

  it("handles null/undefined input", () => {
    expect(normalisePhpObject(null)).toBe(null);
    expect(normalisePhpObject(undefined)).toBe(undefined);
  });
});

// ---------------------------------------------------------------------------
// parseDispatchCache
// ---------------------------------------------------------------------------

describe("parseDispatchCache", () => {
  const sampleResponse = {
    id: ["user@test.com", "rest-uuid-1", "driverΨtest.com"],
    name: ["Test User", "Test Restaurant", "Test Driver"],
    phone: ["6131234567", "6139876543", "6135551234"],
    email: ["user@test.com", "rest@test.com", "driver@test.com"],
    address: [[], ["123 Main St,pembroke"], []],
    user: ["user@test.com"],
    drive: ["driverΨtest.com"],
    rest: ["rest-uuid-1"],
    bans: {
      "driver@test.com": {
        Restaurants: ["rest-uuid-1"],
        Customers: ["banned@test.com"],
      },
    },
    cache: {
      "user@test.com": {
        Type: "User",
        Name: "Test User",
        Email: "user@test.com",
        Phone: "6131234567",
        Contacts: ["sms", "sns", "email"],
      },
      "rest-uuid-1": {
        Type: "Restaurant",
        Name: "Test Restaurant",
        Email: "rest@test.com",
        Phone: "6139876543",
        Market: "Pembroke",
        City: "pembroke",
      },
      "driverΨtest.com": {
        Type: "Driver",
        Name: "Test Driver",
        Email: "driver@test.com",
        Phone: "6135551234",
        DeliveryZone: "Pembroke",
        Alcohol: "false",
        Contacts: ["sms", "email"],
      },
    },
  };

  it("splits cache entries by type", () => {
    const result = parseDispatchCache(sampleResponse);

    expect(result.drivers).toHaveLength(1);
    expect(result.restaurants).toHaveLength(1);
    expect(result.users).toHaveLength(1);
  });

  it("preserves driver entries with correct id", () => {
    const result = parseDispatchCache(sampleResponse);
    expect(result.drivers[0].id).toBe("driverΨtest.com");
    expect(result.drivers[0].entry.Email).toBe("driver@test.com");
    expect(result.drivers[0].entry.Name).toBe("Test Driver");
  });

  it("preserves restaurant entries", () => {
    const result = parseDispatchCache(sampleResponse);
    expect(result.restaurants[0].id).toBe("rest-uuid-1");
    expect(result.restaurants[0].entry.Name).toBe("Test Restaurant");
    expect((result.restaurants[0].entry as any).Market).toBe("Pembroke");
  });

  it("preserves user entries", () => {
    const result = parseDispatchCache(sampleResponse);
    expect(result.users[0].id).toBe("user@test.com");
    expect(result.users[0].entry.Name).toBe("Test User");
  });

  it("preserves ID arrays", () => {
    const result = parseDispatchCache(sampleResponse);
    expect(result.driverIds).toEqual(["driverΨtest.com"]);
    expect(result.restaurantIds).toEqual(["rest-uuid-1"]);
    expect(result.userIds).toEqual(["user@test.com"]);
  });

  it("preserves bans", () => {
    const result = parseDispatchCache(sampleResponse);
    expect(result.bans["driver@test.com"]).toEqual({
      Restaurants: ["rest-uuid-1"],
      Customers: ["banned@test.com"],
    });
  });

  it("normalises PHP boolean strings in cache entries", () => {
    const result = parseDispatchCache(sampleResponse);
    // "false" string in Alcohol should be normalised to boolean false
    expect((result.drivers[0].entry as any).Alcohol).toBe(false);
  });

  it("handles null response", () => {
    const result = parseDispatchCache(null);
    expect(result.drivers).toEqual([]);
    expect(result.restaurants).toEqual([]);
    expect(result.users).toEqual([]);
    expect(result.bans).toEqual({});
  });

  it("handles empty response", () => {
    const result = parseDispatchCache({});
    expect(result.drivers).toEqual([]);
    expect(result.restaurants).toEqual([]);
    expect(result.users).toEqual([]);
  });

  it("handles response with empty cache", () => {
    const result = parseDispatchCache({ cache: {} });
    expect(result.drivers).toEqual([]);
    expect(result.restaurants).toEqual([]);
    expect(result.users).toEqual([]);
  });

  it("handles malformed cache entries gracefully", () => {
    const result = parseDispatchCache({
      cache: {
        "bad-entry": null,
        "also-bad": "not an object",
        "missing-type": { Name: "No Type" },
      },
    });
    // All entries are skipped — null, non-object, and missing/unknown Type
    expect(result.drivers).toEqual([]);
    expect(result.restaurants).toEqual([]);
    expect(result.users).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseIssueRows
// ---------------------------------------------------------------------------

describe("parseIssueRows", () => {
  const sampleHtml = `<div id="issue-abc123" data-status="New" data-read="true" data-mes="true" data-owner="Unassigned" data-orig="customer@test.com" data-market="Pembroke" data-type="Order Issue Other" data-created="1666389297" class="ccpIssueRow" onclick="ccpOpenIssue('issue-abc123')" style="border-left: 6px solid #d62d2d;"><div class="col-xs-9"><p style="font-weight: bold;">customer@test.com</p><b>Order Issue:</b> Other</div><div class="col-xs-3" style="text-align: right;">2022/10/21<br>10:34 PM</div></div><div id="issue-def456" data-status="Pending" data-read="true" data-mes="false" data-owner="Agent Smith" data-orig="driver@test.com" data-market="Perth" data-type="Driver Issue Stale Driver Location" data-created="1666389400" class="ccpIssueRow" onclick="ccpOpenIssue('issue-def456')" style="border-left: 6px solid #fff700;"><div class="col-xs-9"><p style="font-weight: bold;">driver@test.com</p><b>Driver Issue:</b> Stale Driver Location</div><div class="col-xs-3" style="text-align: right;">2022/10/21<br>10:36 PM</div></div>`;

  it("extracts issue rows from HTML", () => {
    const result = parseIssueRows({ html: sampleHtml, badge: 1 });
    expect(result.issues).toHaveLength(2);
    expect(result.badgeCount).toBe(1);
  });

  it("parses first issue correctly", () => {
    const result = parseIssueRows({ html: sampleHtml, badge: 1 });
    const first = result.issues[0];

    expect(first.issueId).toBe("issue-abc123");
    expect(first.status).toBe("New");
    expect(first.hasUnreadMessage).toBe(true);
    expect(first.owner).toBe("Unassigned");
    expect(first.originator).toBe("customer@test.com");
    expect(first.market).toBe("Pembroke");
    expect(first.category).toBe("Order Issue");
    expect(first.issueType).toBe("Other");
    expect(first.created).toBe(1666389297);
  });

  it("parses multi-word issue type correctly", () => {
    const result = parseIssueRows({ html: sampleHtml, badge: 1 });
    const second = result.issues[1];

    expect(second.issueId).toBe("issue-def456");
    expect(second.category).toBe("Driver Issue");
    expect(second.issueType).toBe("Stale Driver Location");
    expect(second.hasUnreadMessage).toBe(false);
    expect(second.owner).toBe("Agent Smith");
    expect(second.market).toBe("Perth");
  });

  it("handles null response", () => {
    const result = parseIssueRows(null);
    expect(result.issues).toEqual([]);
    expect(result.badgeCount).toBe(0);
  });

  it("handles empty HTML", () => {
    const result = parseIssueRows({ html: "", badge: 0 });
    expect(result.issues).toEqual([]);
    expect(result.badgeCount).toBe(0);
  });

  it("handles response with no html key", () => {
    const result = parseIssueRows({ badge: 3 });
    expect(result.issues).toEqual([]);
    expect(result.badgeCount).toBe(3);
  });

  it("handles malformed response", () => {
    const result = parseIssueRows("not an object");
    expect(result.issues).toEqual([]);
    expect(result.badgeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseOrderDetails
// ---------------------------------------------------------------------------

describe("parseOrderDetails", () => {
  it("unwraps DynamoDB wire format order", () => {
    const dynamoOrder = {
      OrderId: { S: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
      OrderIdKey: { S: "a1b2c3d4" },
      OrderStatus: { S: "Pending" },
      OrderType: { S: "Delivery" },
      ASAP: { BOOL: true },
      OrderTotal: { N: "4500" },
      UserId: { S: "customer@test.com" },
      RestaurantId: { S: "rest-uuid-1" },
      RestaurantName: { S: "Test Restaurant" },
      DeliveryZone: { S: "Perth" },
      Alcohol: { BOOL: false },
      OrderItems: {
        L: [
          {
            M: {
              ItemName: { S: "Pizza" },
              Price: { N: "1500" },
              Quantity: { N: "1" },
            },
          },
        ],
      },
    };

    const result = parseOrderDetails(dynamoOrder);
    expect(result).not.toBeNull();
    expect(result!.OrderId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(result!.OrderStatus).toBe("Pending");
    expect(result!.ASAP).toBe(true);
    expect(result!.OrderTotal).toBe(4500);
    expect(result!.Alcohol).toBe(false);

    const items = result!.OrderItems as any[];
    expect(items).toHaveLength(1);
    expect(items[0].ItemName).toBe("Pizza");
    expect(items[0].Price).toBe(1500);
  });

  it("passes through already-plain objects", () => {
    const plainOrder = {
      OrderId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      OrderStatus: "Pending",
      OrderTotal: 4500,
      ASAP: true,
    };

    const result = parseOrderDetails(plainOrder);
    expect(result).not.toBeNull();
    expect(result!.OrderId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(result!.OrderTotal).toBe(4500);
  });

  it("normalises PHP boolean strings in plain objects", () => {
    const phpOrder = {
      OrderId: "a1b2c3d4",
      OrderStatus: "Pending",
      ASAP: "true",
      Alcohol: "false",
      DeliveryConfirmed: "null",
    };

    const result = parseOrderDetails(phpOrder);
    expect(result).not.toBeNull();
    expect(result!.ASAP).toBe(true);
    expect(result!.Alcohol).toBe(false);
    expect(result!.DeliveryConfirmed).toBe(null);
  });

  it("returns null for veERR response", () => {
    expect(parseOrderDetails("veERR")).toBeNull();
  });

  it("returns null for error: response", () => {
    expect(parseOrderDetails("error: invalid parameters")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(parseOrderDetails(null)).toBeNull();
    expect(parseOrderDetails(undefined)).toBeNull();
  });

  it("parses JSON string input", () => {
    const jsonStr = JSON.stringify({
      OrderId: { S: "test-123" },
      OrderStatus: { S: "Confirmed" },
    });

    const result = parseOrderDetails(jsonStr);
    expect(result).not.toBeNull();
    expect(result!.OrderId).toBe("test-123");
    expect(result!.OrderStatus).toBe("Confirmed");
  });

  it("returns null for invalid JSON string", () => {
    expect(parseOrderDetails("not valid json")).toBeNull();
  });

  it("handles order with nested CustomerLocation", () => {
    const order = {
      OrderId: { S: "test-123" },
      CustomerLocation: {
        M: {
          latitude: { N: "44.89" },
          longitude: { N: "-76.25" },
        },
      },
    };

    const result = parseOrderDetails(order);
    expect(result).not.toBeNull();
    const loc = result!.CustomerLocation as any;
    expect(loc.latitude).toBe(44.89);
    expect(loc.longitude).toBe(-76.25);
  });
});

// ---------------------------------------------------------------------------
// parseDriverDetails
// ---------------------------------------------------------------------------

describe("parseDriverDetails", () => {
  it("unwraps DynamoDB wire format driver", () => {
    const dynamoDriver = {
      DriverId: { S: "driver@test.com" },
      FullName: { S: "Test Driver" },
      Phone: { S: "(613) 555-1234" },
      Available: { BOOL: true },
      Paused: { BOOL: false },
      Active: { BOOL: true },
      DeliveryZone: { S: "Pembroke" },
      DispatchZone: { S: "Pembroke" },
      ConnectionId: { S: "AbC123==" },
      AppVersion: { S: "2.6.2" },
      Alcohol: { BOOL: true },
      TrainingOrders: { N: "25" },
      AppSetting: {
        M: {
          Camera: { S: "Full" },
          GeoLocate: { S: "Partial" },
          Microphone: { S: "No" },
          Phone: { S: "Full" },
          Speech: { S: "No" },
        },
      },
    };

    const result = parseDriverDetails(dynamoDriver);
    expect(result).not.toBeNull();
    expect(result!.DriverId).toBe("driver@test.com");
    expect(result!.FullName).toBe("Test Driver");
    expect(result!.Available).toBe(true);
    expect(result!.Paused).toBe(false);
    expect(result!.TrainingOrders).toBe(25);

    const settings = result!.AppSetting as any;
    expect(settings.Camera).toBe("Full");
    expect(settings.GeoLocate).toBe("Partial");
  });

  it("passes through already-plain objects", () => {
    const plainDriver = {
      DriverId: "driver@test.com",
      FullName: "Test Driver",
      Available: true,
    };

    const result = parseDriverDetails(plainDriver);
    expect(result).not.toBeNull();
    expect(result!.DriverId).toBe("driver@test.com");
    expect(result!.Available).toBe(true);
  });

  it("normalises PHP boolean strings", () => {
    const phpDriver = {
      DriverId: "driver@test.com",
      Available: "true",
      Paused: "false",
      Alcohol: "true",
      ignoreArea: "false",
    };

    const result = parseDriverDetails(phpDriver);
    expect(result).not.toBeNull();
    expect(result!.Available).toBe(true);
    expect(result!.Paused).toBe(false);
    expect(result!.Alcohol).toBe(true);
    expect(result!.ignoreArea).toBe(false);
  });

  it("returns null for null/undefined", () => {
    expect(parseDriverDetails(null)).toBeNull();
    expect(parseDriverDetails(undefined)).toBeNull();
  });

  it("parses JSON string input", () => {
    const jsonStr = JSON.stringify({
      DriverId: { S: "driver@test.com" },
      FullName: { S: "Json Driver" },
    });

    const result = parseDriverDetails(jsonStr);
    expect(result).not.toBeNull();
    expect(result!.DriverId).toBe("driver@test.com");
    expect(result!.FullName).toBe("Json Driver");
  });
});

// ---------------------------------------------------------------------------
// Cache ID conversion
// ---------------------------------------------------------------------------

describe("cacheIdToDriverEmail", () => {
  it("converts Ψ back to @", () => {
    expect(cacheIdToDriverEmail("driverΨtest.com")).toBe("driver@test.com");
  });

  it("handles multiple Ψ characters", () => {
    expect(cacheIdToDriverEmail("aΨbΨc")).toBe("a@b@c");
  });

  it("handles string with no Ψ", () => {
    expect(cacheIdToDriverEmail("no-psi-here")).toBe("no-psi-here");
  });
});

describe("driverEmailToCacheId", () => {
  it("converts @ to Ψ", () => {
    expect(driverEmailToCacheId("driver@test.com")).toBe("driverΨtest.com");
  });

  it("handles string with no @", () => {
    expect(driverEmailToCacheId("no-at-here")).toBe("no-at-here");
  });
});
