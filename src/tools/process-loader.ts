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

  const joined = sections.join("\n\n");

  // No truncation — the caller is responsible for passing a curated set of
  // processes (e.g. via selectRelevantProcesses or a manual base set).
  // Agents can fetch additional processes on demand via the lookup_process tool.

  return joined;
}

// ---------------------------------------------------------------------------
// Context-aware process selection
// ---------------------------------------------------------------------------

/** Operational context flags used to decide which process files are relevant. */
export interface ProcessSelectionContext {
  hasActiveOrders: boolean;
  hasOpenTickets: boolean;
  hasDriversOnShift: boolean;
  hasLateOrders: boolean;
  hasNewMessages: boolean;
}

/**
 * Priority ordering used to cap the result set: critical files first.
 */
const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/**
 * Select a small, high-signal set of process files for a given agent and
 * operational context. Designed for use as the "base prompt" — agents can
 * pull in additional procedures on demand via the `lookup_process` tool.
 *
 * Selection rules:
 *   - ALWAYS include AGENTS.md (trigger: "system", agent: "all")
 *   - Include the agent's core communication/tone file (trigger starts with "always_")
 *   - Contextually include files matching active operational conditions
 *   - Cap at 8 files, prioritised by: critical > high > normal > low
 */
export function selectRelevantProcesses(
  processes: ProcessFile[],
  agentName: string,
  context: ProcessSelectionContext,
): ProcessFile[] {
  // Start with processes relevant to this agent (or agent="all")
  const agentProcesses = processes.filter(
    (p) => p.agent === agentName || p.agent === "all",
  );

  const selected = new Set<ProcessFile>();

  // 1. ALWAYS include AGENTS.md (system trigger, agent="all")
  for (const p of agentProcesses) {
    if (p.trigger === "system" && p.agent === "all") {
      selected.add(p);
    }
  }

  // 2. Always include "always_*" trigger files (tone, guidelines, best practices)
  for (const p of agentProcesses) {
    if (p.trigger.startsWith("always_")) {
      selected.add(p);
    }
  }

  // 3. Contextual inclusion by keyword matching on trigger and filename
  const contextKeywords: string[] = [];

  if (context.hasActiveOrders) {
    contextKeywords.push(
      "order_status_change", "driver_assignment", "order_management",
      "reassignment_consideration", "order_reassignment",
      "routing_unassigned", "routing_overloaded", "routing_non_optimal",
      "new_event", "triage",
    );
  }

  if (context.hasOpenTickets) {
    contextKeywords.push(
      "new_ticket", "ticket_resolution", "ticket_classification",
      "ticket_type", "refund_decision", "credits",
      "ticket_assigned", "ticket_created", "escalation_check",
    );
  }

  if (context.hasLateOrders) {
    contextKeywords.push(
      "ticket_type_late", "late_delivery", "courier_will_be_late",
      "courier_running_late", "driver_unresponsive", "no_response",
      "scenario_late_pickup", "scenario_delayed", "market_health_degraded",
      "running_behind",
    );
  }

  if (context.hasNewMessages) {
    contextKeywords.push(
      "new_driver_message", "driver_messaging",
      "communication", "comms_guidelines",
    );
  }

  if (context.hasDriversOnShift) {
    contextKeywords.push(
      "courier_best_practices", "utilization_check",
      "courier_utilization", "shift_start", "shift_end",
    );
  }

  // Match against trigger values and filename keywords
  for (const p of agentProcesses) {
    const triggerLower = p.trigger.toLowerCase();
    const fileNameLower = p.filePath.toLowerCase();

    for (const keyword of contextKeywords) {
      if (triggerLower.includes(keyword) || fileNameLower.includes(keyword.replace(/_/g, "-"))) {
        selected.add(p);
        break;
      }
    }
  }

  // 4. Sort by priority and cap at 8
  const sorted = [...selected].sort(
    (a, b) => (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99),
  );

  const MAX_BASE_FILES = 8;
  if (sorted.length > MAX_BASE_FILES) {
    log.info(
      { agentName, totalSelected: sorted.length, capped: MAX_BASE_FILES },
      "Capping base process files from %d to %d",
      sorted.length,
      MAX_BASE_FILES,
    );
  }

  return sorted.slice(0, MAX_BASE_FILES);
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
