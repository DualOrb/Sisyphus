#!/usr/bin/env tsx
/**
 * CLI tool to validate all process .md files.
 *
 * Loads every .md file from the processes/ directory and checks:
 *   - YAML frontmatter is present and valid
 *   - Required fields: agent, trigger, priority, version
 *   - Agent name matches a known agent
 *   - Priority is one of: critical, high, normal, low
 *   - No duplicate triggers within the same agent
 *   - File is not empty
 *
 * Exits with code 1 if any validation fails, making it suitable for CI.
 *
 * Usage:
 *   tsx scripts/validate-processes.ts
 *   tsx scripts/validate-processes.ts ./processes
 */

import { readFile, readdir } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import matter from "gray-matter";

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
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KNOWN_AGENTS = new Set([
  "supervisor",
  "market-monitor",  // legacy — process files may still reference this
  "driver-comms",
  "customer-support",
  "task-executor",   // legacy — process files may still reference this
  "all",
]);

const VALID_PRIORITIES = new Set([
  "critical",
  "high",
  "normal",
  "low",
]);

const REQUIRED_FIELDS = ["agent", "trigger", "priority", "version"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ValidationResult {
  filePath: string;
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Recursive file collector
// ---------------------------------------------------------------------------

async function collectMdFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectMdFiles(fullPath);
      files.push(...nested);
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      files.push(fullPath);
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Validate a single file
// ---------------------------------------------------------------------------

async function validateFile(filePath: string): Promise<ValidationResult> {
  const errors: string[] = [];

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    return { filePath, valid: false, errors: [`Cannot read file: ${err}`] };
  }

  // Check not empty
  if (raw.trim().length === 0) {
    return { filePath, valid: false, errors: ["File is empty"] };
  }

  // Parse frontmatter
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    return { filePath, valid: false, errors: [`Invalid YAML frontmatter: ${err}`] };
  }

  const data = parsed.data as Record<string, unknown>;

  // Check required fields exist
  for (const field of REQUIRED_FIELDS) {
    if (data[field] === undefined || data[field] === null || String(data[field]).trim() === "") {
      errors.push(`Missing required frontmatter field: "${field}"`);
    }
  }

  // Validate agent name
  const agent = String(data.agent ?? "").trim();
  if (agent && !KNOWN_AGENTS.has(agent)) {
    errors.push(
      `Unknown agent "${agent}". Expected one of: ${Array.from(KNOWN_AGENTS).join(", ")}`,
    );
  }

  // Validate priority
  const priority = String(data.priority ?? "").trim();
  if (priority && !VALID_PRIORITIES.has(priority)) {
    errors.push(
      `Invalid priority "${priority}". Expected one of: ${Array.from(VALID_PRIORITIES).join(", ")}`,
    );
  }

  // Check content body is not empty (after frontmatter)
  if (parsed.content.trim().length === 0) {
    errors.push("File has frontmatter but no content body");
  }

  return {
    filePath,
    valid: errors.length === 0,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("");
  console.log(c.bold("  Sisyphus Process File Validator"));
  console.log("");

  // Determine directory
  const customDir = process.argv[2];
  const processDir = resolve(customDir ?? "processes");

  console.log(`  Directory: ${c.dim(processDir)}`);
  console.log("");

  // Collect files
  let files: string[];
  try {
    files = await collectMdFiles(processDir);
  } catch (err) {
    console.error(c.red(`  Cannot read directory: ${processDir}`));
    console.error(c.dim(`  ${err}`));
    process.exit(1);
  }

  if (files.length === 0) {
    console.log(c.yellow("  No .md files found in the processes directory."));
    process.exit(0);
  }

  console.log(`  Found ${c.cyan(String(files.length))} process files`);
  console.log("");

  // Validate each file
  const results: ValidationResult[] = [];
  for (const file of files.sort()) {
    const result = await validateFile(file);
    results.push(result);
  }

  // Check for duplicate triggers within the same agent
  const triggersByAgent = new Map<string, Map<string, string[]>>();
  for (const result of results) {
    if (!result.valid) continue;

    const raw = await readFile(result.filePath, "utf-8");
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const agent = String(data.agent ?? "");
    const trigger = String(data.trigger ?? "");

    if (!triggersByAgent.has(agent)) {
      triggersByAgent.set(agent, new Map());
    }
    const agentTriggers = triggersByAgent.get(agent)!;
    if (!agentTriggers.has(trigger)) {
      agentTriggers.set(trigger, []);
    }
    agentTriggers.get(trigger)!.push(result.filePath);
  }

  // Flag duplicates
  for (const [agent, triggers] of triggersByAgent) {
    for (const [trigger, files] of triggers) {
      if (files.length > 1) {
        for (const file of files) {
          const result = results.find((r) => r.filePath === file);
          if (result) {
            result.valid = false;
            result.errors.push(
              `Duplicate trigger "${trigger}" for agent "${agent}". Also in: ${files.filter((f) => f !== file).map((f) => f.replace(processDir + "/", "")).join(", ")}`,
            );
          }
        }
      }
    }
  }

  // Print results
  let passed = 0;
  let failed = 0;

  for (const result of results) {
    const relPath = result.filePath.replace(processDir + "/", "");

    if (result.valid) {
      console.log(`  ${c.green("\u2713")} ${relPath}`);
      passed++;
    } else {
      console.log(`  ${c.red("\u2717")} ${relPath}`);
      for (const error of result.errors) {
        console.log(`    ${c.red("-")} ${error}`);
      }
      failed++;
    }
  }

  // Summary
  console.log("");
  console.log("  " + "-".repeat(50));
  const total = passed + failed;
  if (failed === 0) {
    console.log(c.green(`  All ${total} process files are valid.`));
  } else {
    console.log(`  ${c.green(`${passed} valid`)}, ${c.red(`${failed} invalid`)} out of ${total} files.`);
  }
  console.log("");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(c.red("\n  Error:"), err);
  process.exit(1);
});
