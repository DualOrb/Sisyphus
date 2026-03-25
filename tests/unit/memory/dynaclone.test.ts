/**
 * Unit tests for DynaClone utilities.
 *
 * These tests cover the data-conversion helpers that normalise DynaClone's
 * MySQL representation back into the shapes Sisyphus expects. No actual
 * MySQL connections are made.
 */

import { describe, it, expect } from "vitest";
import {
  fixDynacloneArrays,
  parseIntField,
  parseBoolField,
  epochToDate,
} from "@memory/dynaclone/utils";

// ===========================================================================
// fixDynacloneArrays
// ===========================================================================

describe("fixDynacloneArrays", () => {
  it("converts {\"0\": ..., \"1\": ...} to a proper array", () => {
    const input = { "0": "a", "1": "b" };
    const result = fixDynacloneArrays(input);
    expect(result).toEqual(["a", "b"]);
  });

  it("converts numeric-keyed objects with object values", () => {
    const input = {
      "0": { id: 1, name: "first" },
      "1": { id: 2, name: "second" },
    };
    const result = fixDynacloneArrays(input);
    expect(result).toEqual([
      { id: 1, name: "first" },
      { id: 2, name: "second" },
    ]);
  });

  it("passes through normal arrays unchanged", () => {
    const input = ["a", "b", "c"];
    const result = fixDynacloneArrays(input);
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("recursively converts arrays inside normal arrays", () => {
    const input = [{ "0": "x", "1": "y" }];
    const result = fixDynacloneArrays(input);
    expect(result).toEqual([["x", "y"]]);
  });

  it("handles nested objects with mixed array-like and regular keys", () => {
    const input = {
      name: "Test Order",
      items: { "0": { sku: "A" }, "1": { sku: "B" } },
      meta: { version: 2 },
    };
    const result = fixDynacloneArrays<{
      name: string;
      items: { sku: string }[];
      meta: { version: number };
    }>(input);

    expect(result.name).toBe("Test Order");
    expect(result.items).toEqual([{ sku: "A" }, { sku: "B" }]);
    expect(result.meta).toEqual({ version: 2 });
  });

  it("handles deeply nested array-like objects", () => {
    const input = {
      "0": { children: { "0": "deep" } },
      "1": { children: { "0": "also deep" } },
    };
    const result = fixDynacloneArrays(input);
    expect(result).toEqual([
      { children: ["deep"] },
      { children: ["also deep"] },
    ]);
  });

  it("handles null", () => {
    const result = fixDynacloneArrays(null);
    expect(result).toBeNull();
  });

  it("handles undefined", () => {
    const result = fixDynacloneArrays(undefined);
    expect(result).toBeUndefined();
  });

  it("passes through primitive values unchanged", () => {
    expect(fixDynacloneArrays(42)).toBe(42);
    expect(fixDynacloneArrays("hello")).toBe("hello");
    expect(fixDynacloneArrays(true)).toBe(true);
  });

  it("does not convert objects with non-consecutive integer keys", () => {
    const input = { "0": "a", "2": "c" }; // gap: no "1"
    const result = fixDynacloneArrays(input);
    expect(result).toEqual({ "0": "a", "2": "c" });
  });

  it("does not convert objects with non-integer keys mixed in", () => {
    const input = { "0": "a", "1": "b", name: "not-an-array" };
    const result = fixDynacloneArrays(input);
    // Has non-integer key "name", so stays as object
    expect(result).toEqual({ "0": "a", "1": "b", name: "not-an-array" });
  });

  it("handles empty objects (not converted to array)", () => {
    const input = {};
    const result = fixDynacloneArrays(input);
    expect(result).toEqual({});
  });

  it("handles single-element array-like object", () => {
    const input = { "0": "only" };
    const result = fixDynacloneArrays(input);
    expect(result).toEqual(["only"]);
  });
});

// ===========================================================================
// parseIntField
// ===========================================================================

describe("parseIntField", () => {
  it("parses a numeric string to integer", () => {
    expect(parseIntField("42")).toBe(42);
  });

  it("parses a negative numeric string", () => {
    expect(parseIntField("-7")).toBe(-7);
  });

  it("truncates decimal strings to integer", () => {
    expect(parseIntField("3.99")).toBe(3);
  });

  it("returns the number when given a number", () => {
    expect(parseIntField(100)).toBe(100);
  });

  it("truncates decimal numbers to integer", () => {
    expect(parseIntField(3.7)).toBe(3);
  });

  it("returns null for null", () => {
    expect(parseIntField(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseIntField(undefined)).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(parseIntField("abc")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseIntField("")).toBeNull();
  });

  it("returns null for NaN number", () => {
    expect(parseIntField(NaN)).toBeNull();
  });

  it("returns null for Infinity", () => {
    expect(parseIntField(Infinity)).toBeNull();
  });
});

// ===========================================================================
// parseBoolField
// ===========================================================================

describe("parseBoolField", () => {
  it("returns true for 1", () => {
    expect(parseBoolField(1)).toBe(true);
  });

  it("returns false for 0", () => {
    expect(parseBoolField(0)).toBe(false);
  });

  it("returns true for \"1\"", () => {
    expect(parseBoolField("1")).toBe(true);
  });

  it("returns false for \"0\"", () => {
    expect(parseBoolField("0")).toBe(false);
  });

  it("returns true for true", () => {
    expect(parseBoolField(true)).toBe(true);
  });

  it("returns false for false", () => {
    expect(parseBoolField(false)).toBe(false);
  });

  it("returns null for null", () => {
    expect(parseBoolField(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseBoolField(undefined)).toBeNull();
  });

  it("returns null for unrecognised values", () => {
    expect(parseBoolField("yes")).toBeNull();
    expect(parseBoolField(2)).toBeNull();
    expect(parseBoolField("true")).toBeNull();
  });
});

// ===========================================================================
// epochToDate
// ===========================================================================

describe("epochToDate", () => {
  it("converts a Unix epoch number to a Date", () => {
    const epoch = 1717797194; // 2024-06-07 ~UTC
    const date = epochToDate(epoch);
    expect(date).toBeInstanceOf(Date);
    expect(date!.getFullYear()).toBe(2024);
  });

  it("converts a string epoch to a Date", () => {
    const date = epochToDate("1717797194");
    expect(date).toBeInstanceOf(Date);
    expect(date!.getFullYear()).toBe(2024);
  });

  it("returns null for null", () => {
    expect(epochToDate(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(epochToDate(undefined)).toBeNull();
  });

  it("returns null for negative epoch", () => {
    expect(epochToDate(-1)).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(epochToDate("not-a-date")).toBeNull();
  });

  it("converts epoch 0 to 1970-01-01", () => {
    const date = epochToDate(0);
    expect(date).toBeInstanceOf(Date);
    expect(date!.getTime()).toBe(0);
  });
});
