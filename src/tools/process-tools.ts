/**
 * Process file retrieval tool — RAG-based semantic search.
 *
 * At startup, all process files are embedded using a local Ollama model
 * (nomic-embed-text) and stored in-memory. When an agent calls
 * `lookup_process`, the query is embedded and matched by cosine
 * similarity — so "driver isn't picking up food" finds "courier-running-late"
 * even without keyword overlap.
 *
 * Returns the FULL process file content (not fragments).
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { ProcessFile } from "./process-loader.js";
import { createChildLogger } from "../lib/index.js";

const log = createChildLogger("process-tools");

const MAX_CONTENT_CHARS = 3000;
const OLLAMA_URL = "http://localhost:11434";
const EMBED_MODEL = "nomic-embed-text";

// ---------------------------------------------------------------------------
// In-memory vector store (no external deps needed)
// ---------------------------------------------------------------------------

interface EmbeddedProcess {
  process: ProcessFile;
  embedding: number[];
}

let embeddedProcesses: EmbeddedProcess[] = [];

/** Cosine similarity between two vectors. */
function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

/** Get embedding from Ollama. */
async function embed(text: string): Promise<number[]> {
  const resp = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  const data = await resp.json() as { embedding: number[] };
  return data.embedding;
}

/**
 * Initialize the vector store by embedding all process files.
 * Called once at graph build time.
 */
export async function initProcessRAG(processes: ProcessFile[]): Promise<void> {
  const toEmbed = processes.filter(
    (p) => !(p.agent === "all" && p.trigger === "system"),
  );

  // Embed in batches to avoid overwhelming Ollama
  const results: EmbeddedProcess[] = [];
  for (const p of toEmbed) {
    const text = `${p.name}\n${p.trigger}\n${p.agent}\n${p.content.slice(0, 500)}`;
    const embedding = await embed(text);
    results.push({ process: p, embedding });
  }

  embeddedProcesses = results;
  log.info({ count: results.length }, "Process RAG vector store initialized");
}

// ---------------------------------------------------------------------------
// Catalog builder
// ---------------------------------------------------------------------------

/**
 * Build a compact catalog string listing available processes.
 * Included in agent system prompts so they know what to search for.
 */
export function buildProcessCatalog(processes: ProcessFile[]): string {
  const lines = ["## Available Procedures (call lookup_process to load)\n"];

  const byAgent: Record<string, string[]> = {};
  for (const p of processes) {
    if (p.agent === "all" && p.trigger === "system") continue;
    const agent = p.agent || "general";
    if (!byAgent[agent]) byAgent[agent] = [];
    byAgent[agent].push(`- ${p.trigger}: ${p.name}`);
  }

  for (const [agent, items] of Object.entries(byAgent).sort()) {
    lines.push(`**${agent}:**`);
    lines.push(...items);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createProcessTools(processes: ProcessFile[]): DynamicStructuredTool[] {
  const lookupProcessTool = new DynamicStructuredTool({
    name: "lookup_process",
    description:
      "Search for the procedure relevant to your current situation. " +
      "Uses semantic search — describe the situation naturally. " +
      "Returns the full process file with step-by-step instructions.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "Describe the situation (e.g. 'driver not responding', 'customer got wrong food', 'restaurant needs pausing')",
        ),
    }),
    func: async (input) => {
      try {
        const query = input.query.trim();
        if (!query) return "Empty query — describe the situation.";

        // Use RAG if initialized
        if (embeddedProcesses.length > 0) {
          const queryEmb = await embed(query);

          let bestScore = -1;
          let bestProc: ProcessFile | null = null;

          for (const ep of embeddedProcesses) {
            const score = cosineSim(queryEmb, ep.embedding);
            if (score > bestScore) {
              bestScore = score;
              bestProc = ep.process;
            }
          }

          if (!bestProc) return "No matching procedure found.";

          let content = bestProc.content;
          if (content.length > MAX_CONTENT_CHARS) {
            content = content.slice(0, MAX_CONTENT_CHARS) + "\n\n[... truncated ...]";
          }

          log.debug(
            { query, match: bestProc.name, score: bestScore.toFixed(3) },
            "lookup_process RAG match",
          );

          return (
            `--- ${bestProc.name} ---\n` +
            `Trigger: ${bestProc.trigger} | Agent: ${bestProc.agent} | Priority: ${bestProc.priority}\n\n` +
            content
          );
        }

        // Fallback: keyword search
        return keywordSearch(processes, query);
      } catch (err) {
        log.error({ err, query: input.query }, "lookup_process failed");
        // Fall back to keyword search on embedding failure
        return keywordSearch(processes, input.query);
      }
    },
  });

  return [lookupProcessTool];
}

// ---------------------------------------------------------------------------
// Keyword fallback
// ---------------------------------------------------------------------------

function keywordSearch(processes: ProcessFile[], query: string): string {
  const tokens = query.toLowerCase().split(/[\s\-_./,;:!?()]+/).filter((w) => w.length > 2);

  let bestScore = 0;
  let bestProc: ProcessFile | null = null;

  for (const p of processes) {
    if (p.agent === "all" && p.trigger === "system") continue;
    let score = 0;
    const lower = (p.name + " " + p.trigger + " " + p.content.slice(0, 500)).toLowerCase();
    for (const t of tokens) {
      if (lower.includes(t)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestProc = p;
    }
  }

  if (!bestProc) return "No matching procedure found.";

  let content = bestProc.content;
  if (content.length > MAX_CONTENT_CHARS) {
    content = content.slice(0, MAX_CONTENT_CHARS) + "\n\n[... truncated ...]";
  }

  return (
    `--- ${bestProc.name} ---\n` +
    `Trigger: ${bestProc.trigger} | Agent: ${bestProc.agent} | Priority: ${bestProc.priority}\n\n` +
    content
  );
}
