#!/usr/bin/env tsx
/**
 * CLI tool to inspect all registered actions.
 *
 * Registers every action, then prints a formatted table showing the
 * configuration of each action definition: tier, execution method,
 * cooldown, rate limit, criteria count, and param schema fields.
 *
 * Useful for verifying action configuration after changes.
 *
 * Usage:
 *   tsx scripts/inspect-actions.ts
 */

import { registerAllActions } from "../src/ontology/actions/index.js";
import { listActions, clearActions } from "../src/guardrails/registry.js";
import type { ActionDefinition } from "../src/guardrails/types.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function padR(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function padL(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : " ".repeat(len - s.length) + s;
}

function tierColor(tier: string): string {
  switch (tier) {
    case "GREEN": return c.green(tier);
    case "YELLOW": return c.yellow(tier);
    case "ORANGE": return c.magenta(tier);
    case "RED": return c.red(tier);
    default: return tier;
  }
}

// ---------------------------------------------------------------------------
// Zod schema field extraction
// ---------------------------------------------------------------------------

/**
 * Extract field names and types from a Zod schema.
 * Handles ZodObject at the top level and returns field info.
 */
function extractSchemaFields(schema: z.ZodType): { name: string; type: string; required: boolean }[] {
  const fields: { name: string; type: string; required: boolean }[] = [];

  // Unwrap ZodEffects (e.g. .refine(), .transform())
  let inner: z.ZodType = schema;
  while (inner instanceof z.ZodEffects) {
    inner = (inner as z.ZodEffects<z.ZodType>)._def.schema;
  }

  if (inner instanceof z.ZodObject) {
    const shape = inner.shape;
    for (const [key, value] of Object.entries(shape)) {
      const zodField = value as z.ZodType;
      fields.push({
        name: key,
        type: describeZodType(zodField),
        required: !isOptional(zodField),
      });
    }
  }

  return fields;
}

/**
 * Return a human-readable type label for a Zod type.
 */
function describeZodType(schema: z.ZodType): string {
  if (schema instanceof z.ZodString) return "string";
  if (schema instanceof z.ZodNumber) return "number";
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodEnum) {
    const vals = (schema as z.ZodEnum<[string, ...string[]]>)._def.values;
    if (vals.length <= 4) return `enum(${vals.join("|")})`;
    return `enum(${vals.slice(0, 3).join("|")}|...)`;
  }
  if (schema instanceof z.ZodOptional) {
    return describeZodType((schema as z.ZodOptional<z.ZodType>)._def.innerType) + "?";
  }
  if (schema instanceof z.ZodNullable) {
    return describeZodType((schema as z.ZodNullable<z.ZodType>)._def.innerType) + " | null";
  }
  if (schema instanceof z.ZodArray) {
    return describeZodType((schema as z.ZodArray<z.ZodType>)._def.type) + "[]";
  }
  if (schema instanceof z.ZodObject) return "object";
  if (schema instanceof z.ZodEffects) return "transformed";
  return "unknown";
}

/**
 * Check if a Zod type is optional.
 */
function isOptional(schema: z.ZodType): boolean {
  if (schema instanceof z.ZodOptional) return true;
  if (schema instanceof z.ZodDefault) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("");
  console.log(c.bold("  Sisyphus Action Registry Inspector"));
  console.log(c.dim("  Registers all actions and displays their configuration."));
  console.log("");

  // Clear and register fresh
  clearActions();
  await registerAllActions();

  const actions = listActions();
  console.log(`  ${c.cyan(`${actions.length} actions registered`)}`);
  console.log("");

  // Table header
  const colName = 24;
  const colTier = 8;
  const colExec = 10;
  const colCooldown = 14;
  const colRate = 14;
  const colCriteria = 10;

  const divider = "-".repeat(colName + colTier + colExec + colCooldown + colRate + colCriteria + 12);

  console.log(
    `  ${padR("Name", colName)} ${padR("Tier", colTier)} ${padR("Execution", colExec)} ${padR("Cooldown", colCooldown)} ${padR("Rate Limit", colRate)} ${padL("Criteria", colCriteria)}`,
  );
  console.log(`  ${divider}`);

  for (const action of actions) {
    const cooldownStr = action.cooldown
      ? `${action.cooldown.entity}:${action.cooldown.ttlSeconds}s`
      : c.dim("none");
    const rateLimitStr = action.rateLimit
      ? `${action.rateLimit.maxPerHour}/hr (${action.rateLimit.scope})`
      : c.dim("none");

    const tierStr = tierColor(action.tier as string);
    // Account for ANSI codes in padding
    const tierPadded = padR(tierStr, colTier + 9);

    console.log(
      `  ${padR(action.name, colName)} ${tierPadded} ${padR(action.execution, colExec)} ${padR(cooldownStr, cooldownStr.includes("\x1b") ? colCooldown + 9 : colCooldown)} ${padR(rateLimitStr, rateLimitStr.includes("\x1b") ? colRate + 9 : colRate)} ${padL(String(action.criteria.length), colCriteria)}`,
    );
  }

  // Detailed param schemas
  console.log("");
  console.log(c.bold("  Param Schemas"));
  console.log(`  ${divider}`);

  for (const action of actions) {
    console.log("");
    console.log(`  ${c.bold(action.name)} ${c.dim(`(${action.description})`)}`);

    const fields = extractSchemaFields(action.paramsSchema);
    if (fields.length === 0) {
      console.log(c.dim("    (no params)"));
      continue;
    }

    for (const field of fields) {
      const reqTag = field.required ? c.red("*") : " ";
      console.log(`    ${reqTag} ${c.cyan(padR(field.name, 22))} ${c.dim(field.type)}`);
    }

    // Show criteria names
    if (action.criteria.length > 0) {
      console.log(c.dim(`    Criteria: ${action.criteria.map((cr) => cr.name).join(", ")}`));
    }

    // Show side effects
    if (action.sideEffects && action.sideEffects.length > 0) {
      console.log(c.dim(`    Side effects: ${action.sideEffects.join(", ")}`));
    }
  }

  console.log("");
}

main().catch((err) => {
  console.error(c.red("\n  Error:"), err);
  process.exit(1);
});
