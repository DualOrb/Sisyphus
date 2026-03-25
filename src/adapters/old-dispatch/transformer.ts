/**
 * Transforms old dispatch API responses (dispatch.valleyeats.ca) into
 * the format expected by our existing ontology transformers.
 *
 * The old dispatch is PHP-based and returns data in several formats:
 *
 * 1. **builddispatchcache.php** — A lookup cache with {cache, user, drive, rest, bans}
 *    where `cache` is keyed by ID and entries have a `Type` field.
 *    Entries are simplified (Name, Email, Phone, etc.), NOT full DynamoDB records.
 *
 * 2. **getorder.php** — Raw DynamoDB wire format with {S: "string"}, {N: "123"},
 *    {BOOL: true}, {L: [...]}, {M: {...}} type wrappers.
 *
 * 3. **buildissuerows.php** — Returns {html, badge} (HTML, not structured data).
 *    Issue data must be extracted from the HTML data attributes or fetched elsewhere.
 *
 * 4. **getadminorder.php / getadmindriver.php / builddriverselect.php** — Return HTML.
 *    Not usable for structured data; here for completeness.
 *
 * The key job of these transformers:
 * - Unwrap DynamoDB wire format into plain JS values
 * - Split the dispatch cache blob into typed arrays
 * - Normalise PHP quirks (boolean strings, null strings, etc.)
 * - Produce objects that our existing transformOrder / transformDriver etc. can consume
 */

// ---------------------------------------------------------------------------
// DynamoDB wire-format unwrapper
// ---------------------------------------------------------------------------

/**
 * Recursively unwraps a DynamoDB-marshalled value into a plain JS value.
 *
 * DynamoDB wire format uses typed wrappers:
 *   { S: "hello" }           → "hello"
 *   { N: "42" }              → 42
 *   { BOOL: true }           → true
 *   { NULL: true }           → null
 *   { L: [ {S:"a"}, ... ] }  → ["a", ...]
 *   { M: { key: {S:"v"} } }  → { key: "v" }
 *
 * If the value is already plain (no type wrapper), it's returned as-is.
 */
export function unwrapDynamoValue(val: unknown): unknown {
  if (val == null) return null;
  if (typeof val !== "object") return val;

  const obj = val as Record<string, unknown>;

  // Type-descriptor keys in order of likelihood
  if ("S" in obj && typeof obj.S === "string") return obj.S;
  if ("N" in obj) return Number(obj.N);
  if ("BOOL" in obj) return Boolean(obj.BOOL);
  if ("NULL" in obj) return null;

  if ("L" in obj && Array.isArray(obj.L)) {
    return (obj.L as unknown[]).map(unwrapDynamoValue);
  }

  if ("M" in obj && typeof obj.M === "object" && obj.M != null) {
    return unwrapDynamoItem(obj.M as Record<string, unknown>);
  }

  // No type wrapper detected — could be a plain object or an already-
  // unwrapped DynamoDB map. Recurse into each key.
  if (Array.isArray(val)) {
    return val.map(unwrapDynamoValue);
  }

  // Plain object — check if ALL keys look like DynamoDB type descriptors
  // (single-key objects with S/N/BOOL/NULL/L/M). If not, recurse anyway.
  const keys = Object.keys(obj);
  if (keys.length === 1 && ["S", "N", "BOOL", "NULL", "L", "M", "SS", "NS", "BS"].includes(keys[0])) {
    // Already handled above, shouldn't reach here, but just in case
    return val;
  }

  // Regular object — recurse into values
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = unwrapDynamoValue(obj[key]);
  }
  return result;
}

/**
 * Unwraps an entire DynamoDB item (a map of attribute name → typed value).
 */
export function unwrapDynamoItem(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(item)) {
    result[key] = unwrapDynamoValue(val);
  }
  return result;
}

// ---------------------------------------------------------------------------
// PHP value normalisation
// ---------------------------------------------------------------------------

/**
 * Normalises PHP-serialised quirks that show up in JSON responses:
 *
 * - "1" / "0" for booleans → true / false
 * - "true" / "false" strings → true / false
 * - "null" string → null
 * - "" (empty string when PHP meant null) → null  (opt-in via `emptyToNull`)
 * - Numeric strings that should be numbers → number
 *
 * This operates on a single value. For a whole object, use `normalisePhpObject`.
 */
export function normalisePhpValue(
  val: unknown,
  opts?: { emptyToNull?: boolean },
): unknown {
  if (val === undefined) return undefined;
  if (val === null) return null;

  if (typeof val === "string") {
    // Boolean strings
    if (val === "true") return true;
    if (val === "false") return false;

    // Null string
    if (val === "null") return null;

    // PHP often uses "1" and "0" for booleans, but they can also be
    // legitimate numeric values. We do NOT convert these here — the caller
    // or downstream transformer should handle the semantic meaning.

    // Empty string → null (opt-in)
    if (opts?.emptyToNull && val === "") return null;
  }

  return val;
}

/**
 * Deep-normalises an object's values using `normalisePhpValue`.
 * Recurses into nested objects and arrays.
 */
export function normalisePhpObject(
  obj: unknown,
  opts?: { emptyToNull?: boolean },
): unknown {
  if (obj == null) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => normalisePhpObject(item, opts));
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = normalisePhpObject(val, opts);
    }
    return result;
  }

  return normalisePhpValue(obj, opts);
}

// ---------------------------------------------------------------------------
// Dispatch cache parser
// ---------------------------------------------------------------------------

/**
 * Shape of the `cache` entry in the builddispatchcache response.
 * This is a simplified lookup record, NOT a full DynamoDB entity.
 */
export interface CacheEntry {
  Type: "Driver" | "Restaurant" | "User";
  Name?: string;
  Email?: string;
  Phone?: string;
  [key: string]: unknown;
}

/**
 * Shape returned by builddispatchcache.php.
 */
export interface DispatchCacheResponse {
  id?: string[];
  name?: string[];
  phone?: string[];
  email?: string[];
  address?: unknown[];
  user?: string[];
  drive?: string[];
  rest?: string[];
  bans?: Record<string, { Restaurants?: string[]; Customers?: string[] }>;
  cache?: Record<string, CacheEntry>;
}

/**
 * Parsed output from parseDispatchCache — the cache split into typed arrays
 * with enough info for quick lookups and the existing ontology transformers.
 */
export interface ParsedDispatchCache {
  /** Driver cache entries, keyed by transformed ID (@ → Ψ) */
  drivers: Array<{ id: string; entry: CacheEntry }>;
  /** Restaurant cache entries, keyed by RestaurantId */
  restaurants: Array<{ id: string; entry: CacheEntry }>;
  /** User/customer cache entries, keyed by email */
  users: Array<{ id: string; entry: CacheEntry }>;
  /** Raw driver IDs (with Ψ replacement) */
  driverIds: string[];
  /** Raw restaurant IDs */
  restaurantIds: string[];
  /** Raw user IDs */
  userIds: string[];
  /** Driver bans lookup */
  bans: Record<string, { Restaurants?: string[]; Customers?: string[] }>;
}

/**
 * Parses the builddispatchcache.php response into typed arrays.
 *
 * The cache is a flat lookup keyed by ID. Each entry has a `Type` field
 * ("Driver", "Restaurant", "User") which we use to split them.
 *
 * Note: These are *summary* records, not full DynamoDB items. They contain
 * Name, Email, Phone, and a few type-specific fields. For full entity data,
 * use getorder.php / getadmindriver.php etc.
 */
export function parseDispatchCache(
  response: unknown,
): ParsedDispatchCache {
  const empty: ParsedDispatchCache = {
    drivers: [],
    restaurants: [],
    users: [],
    driverIds: [],
    restaurantIds: [],
    userIds: [],
    bans: {},
  };

  if (response == null || typeof response !== "object") return empty;

  const data = response as DispatchCacheResponse;
  const cache = data.cache;

  if (cache == null || typeof cache !== "object") return empty;

  const drivers: ParsedDispatchCache["drivers"] = [];
  const restaurants: ParsedDispatchCache["restaurants"] = [];
  const users: ParsedDispatchCache["users"] = [];

  for (const [id, entry] of Object.entries(cache)) {
    if (entry == null || typeof entry !== "object") continue;

    const normalised = normalisePhpObject(entry) as CacheEntry;

    switch (normalised.Type) {
      case "Driver":
        drivers.push({ id, entry: normalised });
        break;
      case "Restaurant":
        restaurants.push({ id, entry: normalised });
        break;
      case "User":
        users.push({ id, entry: normalised });
        break;
      // Unknown type — skip silently
    }
  }

  return {
    drivers,
    restaurants,
    users,
    driverIds: Array.isArray(data.drive) ? data.drive : [],
    restaurantIds: Array.isArray(data.rest) ? data.rest : [],
    userIds: Array.isArray(data.user) ? data.user : [],
    bans:
      data.bans != null && typeof data.bans === "object" ? data.bans : {},
  };
}

// ---------------------------------------------------------------------------
// Issue rows parser
// ---------------------------------------------------------------------------

/**
 * Parsed issue row from buildissuerows HTML data attributes.
 */
export interface ParsedIssueRow {
  issueId: string;
  status: string;
  hasUnreadMessage: boolean;
  owner: string;
  originator: string;
  market: string;
  /** Combined "Category IssueType" from data-type */
  type: string;
  category: string;
  issueType: string;
  created: number;
}

/**
 * Parses the buildissuerows.php response.
 *
 * This endpoint returns `{ html: string, badge: number }`.
 * The HTML contains `<div>` elements with data attributes holding structured
 * issue data. We extract data from those attributes to avoid depending on
 * the visual layout.
 *
 * Returns an array of parsed issue rows, or empty array on failure.
 */
export function parseIssueRows(
  response: unknown,
): { issues: ParsedIssueRow[]; badgeCount: number } {
  const empty = { issues: [] as ParsedIssueRow[], badgeCount: 0 };

  if (response == null || typeof response !== "object") return empty;

  const data = response as { html?: string; badge?: number };
  const html = data.html;
  const badgeCount = typeof data.badge === "number" ? data.badge : 0;

  if (typeof html !== "string" || html.length === 0) {
    return { issues: [], badgeCount };
  }

  const issues: ParsedIssueRow[] = [];

  // Match each ccpIssueRow div and extract data attributes.
  // Pattern: id="<issueId>" data-status="..." data-read="..." data-mes="..."
  //          data-owner="..." data-orig="..." data-market="..." data-type="..."
  //          data-created="..."
  const rowRegex =
    /id="([^"]+)"\s+data-status="([^"]+)"\s+data-read="([^"]+)"\s+data-mes="([^"]+)"\s+data-owner="([^"]+)"\s+data-orig="([^"]+)"\s+data-market="([^"]+)"\s+data-type="([^"]+)"\s+data-created="([^"]+)"\s+class="ccpIssueRow"/g;

  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(html)) !== null) {
    const typeStr = match[8]; // "Order Issue Other", "Driver Issue Stale Driver Location"
    const parts = typeStr.split(" ");

    // Category is the first two words (e.g., "Order Issue"), IssueType is the rest
    let category = "Order Issue";
    let issueType = "Other";
    if (parts.length >= 3) {
      category = parts.slice(0, 2).join(" ");
      issueType = parts.slice(2).join(" ");
    } else if (parts.length === 2) {
      category = parts.join(" ");
    }

    issues.push({
      issueId: match[1],
      status: match[2],
      hasUnreadMessage: match[4] === "true",
      owner: match[5],
      originator: match[6],
      market: match[7],
      type: typeStr,
      category,
      issueType,
      created: Number(match[9]) || 0,
    });
  }

  return { issues, badgeCount };
}

// ---------------------------------------------------------------------------
// Order details parser (getorder.php)
// ---------------------------------------------------------------------------

/**
 * Parses the getorder.php response into a plain object suitable for
 * `transformOrder()`.
 *
 * getorder.php returns a raw DynamoDB item with type wrappers:
 *   { OrderId: { S: "abc-123" }, OrderStatus: { S: "Pending" }, ... }
 *
 * We unwrap the DynamoDB types and normalise PHP quirks.
 *
 * If the response is the error string "veERR", returns null.
 */
export function parseOrderDetails(
  response: unknown,
): Record<string, unknown> | null {
  if (response == null) return null;

  // getorder.php returns "veERR" on failure
  if (typeof response === "string") {
    if (response === "veERR" || response.startsWith("error:")) return null;
    // Try to parse JSON string
    try {
      response = JSON.parse(response);
    } catch {
      return null;
    }
  }

  if (typeof response !== "object") return null;

  const raw = response as Record<string, unknown>;

  // Detect DynamoDB wire format: if any top-level value is an object with
  // a single key that is a DynamoDB type descriptor (S, N, BOOL, etc.)
  if (isDynamoFormat(raw)) {
    const unwrapped = unwrapDynamoItem(raw);
    return normalisePhpObject(unwrapped) as Record<string, unknown>;
  }

  // Already plain — just normalise PHP quirks
  return normalisePhpObject(raw) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Driver details parser
// ---------------------------------------------------------------------------

/**
 * Parses driver data from DynamoDB wire format into a plain object
 * suitable for `transformDriver()`.
 *
 * Note: `getadmindriver.php` returns HTML, not JSON. This parser is for
 * cases where we obtain raw DynamoDB driver records through other means
 * (e.g., direct DynamoDB query, or the dispatch cache supplemented with
 * a full scan).
 *
 * If the data is already in plain format (e.g., from the dispatch cache),
 * it normalises PHP quirks and returns it directly.
 */
export function parseDriverDetails(
  response: unknown,
): Record<string, unknown> | null {
  if (response == null) return null;

  if (typeof response === "string") {
    try {
      response = JSON.parse(response);
    } catch {
      return null;
    }
  }

  if (typeof response !== "object") return null;

  const raw = response as Record<string, unknown>;

  if (isDynamoFormat(raw)) {
    const unwrapped = unwrapDynamoItem(raw);
    return normalisePhpObject(unwrapped) as Record<string, unknown>;
  }

  return normalisePhpObject(raw) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Heuristic: detects whether an object is in DynamoDB wire format
 * by checking if the first few values are single-key objects with
 * a DynamoDB type descriptor key.
 */
function isDynamoFormat(obj: Record<string, unknown>): boolean {
  const dynamoTypeKeys = new Set(["S", "N", "BOOL", "NULL", "L", "M", "SS", "NS", "BS"]);
  const entries = Object.entries(obj);

  // Need at least one entry to check
  if (entries.length === 0) return false;

  // Check up to 5 entries
  let dynamoCount = 0;
  const checkCount = Math.min(entries.length, 5);

  for (let i = 0; i < checkCount; i++) {
    const val = entries[i][1];
    if (val != null && typeof val === "object" && !Array.isArray(val)) {
      const keys = Object.keys(val as Record<string, unknown>);
      if (keys.length === 1 && dynamoTypeKeys.has(keys[0])) {
        dynamoCount++;
      }
    }
  }

  // If most checked entries look like DynamoDB format, assume it is
  return dynamoCount >= Math.ceil(checkCount / 2);
}

/**
 * Converts a driver ID from the dispatch cache format back to an email.
 * The cache replaces @ with Ψ in driver IDs to avoid overlap with user emails.
 */
export function cacheIdToDriverEmail(cacheId: string): string {
  return cacheId.replace(/Ψ/g, "@");
}

/**
 * Converts a driver email to the cache ID format.
 */
export function driverEmailToCacheId(email: string): string {
  return email.replace(/@/g, "Ψ");
}
