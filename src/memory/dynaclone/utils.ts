/**
 * DynaClone data utilities.
 *
 * DynaClone replicates DynamoDB data into MySQL, which introduces several
 * data-representation quirks that these helpers normalise.
 */

/**
 * Convert DynaClone's JSON-object representation of arrays back into real
 * arrays.
 *
 * DynamoDB lists are stored in MySQL as objects keyed by index:
 *   `{"0": {...}, "1": {...}}` instead of `[{...}, {...}]`
 *
 * This function recursively walks a value and converts any object whose
 * keys are consecutive zero-based integers into a proper array.
 */
export function fixDynacloneArrays<T = unknown>(val: unknown): T {
  if (val === null || val === undefined) {
    return val as T;
  }

  if (Array.isArray(val)) {
    return val.map((item) => fixDynacloneArrays(item)) as T;
  }

  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const keys = Object.keys(obj);

    // Check if every key is a consecutive integer starting from 0
    if (keys.length > 0 && isConsecutiveIntKeys(keys)) {
      // Convert to array, preserving order by numeric key
      const arr = keys
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => fixDynacloneArrays(obj[k]));
      return arr as T;
    }

    // Regular object — recurse into values
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = fixDynacloneArrays(v);
    }
    return result as T;
  }

  // Primitive — return as-is
  return val as T;
}

/**
 * Returns true if `keys` are string representations of consecutive integers
 * starting at 0 (i.e., "0", "1", "2", ...).
 */
function isConsecutiveIntKeys(keys: string[]): boolean {
  if (keys.length === 0) return false;

  const nums = keys.map(Number);

  // All keys must parse to finite integers
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || !Number.isInteger(n))) {
    return false;
  }

  nums.sort((a, b) => a - b);

  // Must start at 0 and be consecutive
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i) return false;
  }

  return true;
}

/**
 * Safely parse a MySQL field value to an integer.
 *
 * MySQL returns all fields as strings via mysql2. This helper handles
 * strings, numbers, null, and undefined gracefully.
 */
export function parseIntField(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return Number.isFinite(val) ? Math.trunc(val) : null;
  if (typeof val === "string") {
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Safely parse a MySQL 0/1 field to a boolean.
 *
 * Handles: 0, 1, "0", "1", true, false, null, undefined.
 */
export function parseBoolField(val: unknown): boolean | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "boolean") return val;
  if (val === 1 || val === "1") return true;
  if (val === 0 || val === "0") return false;
  return null;
}

/**
 * Convert a Unix epoch (seconds) value to a Date object.
 *
 * Returns null if the input is null, undefined, or not a valid epoch.
 */
export function epochToDate(val: unknown): Date | null {
  if (val === null || val === undefined) return null;

  let epoch: number;
  if (typeof val === "number") {
    epoch = val;
  } else if (typeof val === "string") {
    epoch = parseFloat(val);
  } else {
    return null;
  }

  if (!Number.isFinite(epoch) || epoch < 0) return null;

  return new Date(epoch * 1000);
}
