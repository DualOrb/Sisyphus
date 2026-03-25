/**
 * Process .md file loader — reads, parses, and organizes process files
 * that define agent behavior via YAML frontmatter + markdown content.
 *
 * Process files are the "business logic layer" of Sisyphus: they tell agents
 * what to do in specific situations, using plain English backed by structured
 * metadata. Editing a markdown file changes agent behavior without code deployment.
 *
 * @see planning/03-agent-design.md sections 3, 6
 */

import { readFile, readdir } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import matter from "gray-matter";
import { createChildLogger } from "../lib/index.js";

const log = createChildLogger("process-loader");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessFile {
  /** Process name derived from the first heading or filename */
  name: string;
  /** Which agent this process applies to (e.g. "driver-comms", "all") */
  agent: string;
  /** What triggers this process (e.g. "new_driver_message", "system") */
  trigger: string;
  /** Priority level (e.g. "normal", "critical") */
  priority: string;
  /** Semantic version of this process definition */
  version: string;
  /** The markdown body content (without frontmatter) */
  content: string;
  /** Absolute path to the source file */
  filePath: string;
}

// ---------------------------------------------------------------------------
// Single file loader
// ---------------------------------------------------------------------------

/**
 * Load and parse a single process .md file.
 *
 * Uses `gray-matter` to extract YAML frontmatter. Missing frontmatter fields
 * are replaced with sensible defaults and a warning is logged.
 */
export async function loadProcessFileAsync(
  filePath: string,
): Promise<ProcessFile> {
  const absolutePath = resolve(filePath);
  const raw = await readFile(absolutePath, "utf-8");

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    log.warn({ filePath: absolutePath, err }, "Failed to parse frontmatter");
    throw new Error(`Malformed frontmatter in ${absolutePath}: ${err}`);
  }

  const data = parsed.data as Record<string, unknown>;
  const content = parsed.content.trim();

  // Extract process name from first markdown heading, or fall back to filename
  const headingMatch = content.match(/^#\s+(.+)$/m);
  const nameFromHeading = headingMatch ? headingMatch[1].trim() : undefined;
  const nameFromFile = absolutePath
    .split("/")
    .pop()!
    .replace(/\.md$/, "");

  const name =
    typeof data.name === "string"
      ? data.name
      : nameFromHeading ?? nameFromFile;

  // Validate required frontmatter fields, fall back with warnings
  const agent = expectString(data, "agent", absolutePath) ?? "unknown";
  const trigger = expectString(data, "trigger", absolutePath) ?? "manual";
  const priority = expectString(data, "priority", absolutePath) ?? "normal";
  const version = String(data.version ?? "1.0");

  return {
    name,
    agent,
    trigger,
    priority,
    version,
    content,
    filePath: absolutePath,
  };
}

// ---------------------------------------------------------------------------
// Directory loader (recursive)
// ---------------------------------------------------------------------------

/**
 * Recursively load all .md files from a directory.
 *
 * Malformed files are logged and skipped — they do not cause the entire
 * load to fail. This is intentional: a single bad process file should not
 * prevent the system from starting.
 */
export async function loadProcessDirectory(
  dirPath: string,
): Promise<ProcessFile[]> {
  const absoluteDir = resolve(dirPath);
  const results: ProcessFile[] = [];

  const entries = await readdir(absoluteDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(absoluteDir, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      const subResults = await loadProcessDirectory(fullPath);
      results.push(...subResults);
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      try {
        const processFile = await loadProcessFileAsync(fullPath);
        results.push(processFile);
        log.debug(
          { name: processFile.name, agent: processFile.agent, filePath: fullPath },
          "Loaded process file",
        );
      } catch (err) {
        log.warn(
          { filePath: fullPath, err },
          "Skipping malformed process file",
        );
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Filter by agent
// ---------------------------------------------------------------------------

/**
 * Filter process files to those relevant to a specific agent.
 *
 * Returns processes where `agent` matches the given name OR where
 * `agent` is "all" (global rules that apply to every agent).
 */
export function getProcessesForAgent(
  processes: ProcessFile[],
  agentName: string,
): ProcessFile[] {
  return processes.filter(
    (p) => p.agent === agentName || p.agent === "all",
  );
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/**
 * Build a complete system prompt for an agent by concatenating:
 *   1. AGENTS.md global rules (processes with agent="all")
 *   2. Agent-specific process files (matching agentName)
 *
 * The result is a single string suitable for use as a LangGraph agent's
 * system message.
 */
export function buildSystemPrompt(
  agentName: string,
  processes: ProcessFile[],
): string {
  const relevant = getProcessesForAgent(processes, agentName);

  // Separate global (agent="all") from agent-specific
  const global = relevant.filter((p) => p.agent === "all");
  const specific = relevant.filter((p) => p.agent !== "all");

  // Sort specific processes by priority: critical > high > normal > low
  const priorityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
  };
  specific.sort(
    (a, b) =>
      (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99),
  );

  const sections: string[] = [];

  // Global rules first
  for (const proc of global) {
    sections.push(proc.content);
  }

  // Agent-specific processes
  if (specific.length > 0) {
    sections.push(`\n---\n\n## Agent: ${agentName} — Process Files\n`);
    for (const proc of specific) {
      sections.push(
        `<!-- process: ${proc.name} | trigger: ${proc.trigger} | priority: ${proc.priority} | v${proc.version} -->\n${proc.content}`,
      );
    }
  }

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract a string field from frontmatter data, logging a warning if missing.
 */
function expectString(
  data: Record<string, unknown>,
  field: string,
  filePath: string,
): string | undefined {
  const value = data[field];
  if (value === undefined || value === null) {
    log.warn(
      { filePath, field },
      `Missing frontmatter field "${field}" — using default`,
    );
    return undefined;
  }
  return String(value);
}
