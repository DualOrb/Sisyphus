/**
 * Process file retrieval tool — lets agents search and retrieve relevant
 * process files on demand via the `lookup_process` tool.
 *
 * Instead of loading all 70+ process files into every system prompt,
 * agents start with a small base prompt and pull in detailed procedures
 * as needed. This keeps prompts lean and context-window friendly.
 *
 * @see planning/03-agent-design.md sections 3, 6
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { ProcessFile } from "./process-loader.js";
import { createChildLogger } from "../lib/index.js";

const log = createChildLogger("process-tools");

// ---------------------------------------------------------------------------
// Stop words — filtered from queries before scoring
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must",
  "i", "me", "my", "we", "our", "you", "your", "he", "she", "it",
  "they", "them", "their", "this", "that", "these", "those",
  "and", "or", "but", "if", "then", "so", "because", "as", "of",
  "in", "on", "at", "to", "for", "with", "by", "from", "about",
  "into", "through", "during", "before", "after", "above", "below",
  "not", "no", "nor", "only", "just", "also", "very", "too",
  "what", "which", "who", "when", "where", "how", "why",
]);

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface ScoredProcess {
  process: ProcessFile;
  score: number;
}

/**
 * Normalize a query string into scoring tokens:
 * lowercase, split on whitespace/punctuation, remove stop words and short tokens.
 */
function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s\-_./,;:!?()]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Score a single ProcessFile against the query tokens.
 *
 * Scoring:
 *   - trigger exact match:       +10
 *   - trigger partial match:     +5  (query token appears in trigger)
 *   - name contains query word:  +5  per matching word
 *   - content keyword match:     +1  per occurrence
 */
function scoreProcess(process: ProcessFile, tokens: string[], rawQuery: string): number {
  let score = 0;

  const triggerLower = process.trigger.toLowerCase();
  const nameLower = process.name.toLowerCase();
  const contentLower = process.content.toLowerCase();

  // 1. Exact trigger match — the query IS the trigger
  const queryNormalized = rawQuery.toLowerCase().trim().replace(/[\s\-]+/g, "_");
  if (triggerLower === queryNormalized) {
    score += 10;
  }

  for (const token of tokens) {
    // 2. Trigger contains the token (partial trigger match)
    if (triggerLower.includes(token)) {
      score += 5;
    }

    // 3. Name contains the token
    if (nameLower.includes(token)) {
      score += 5;
    }

    // 4. Content keyword occurrences
    let searchStart = 0;
    let occurrences = 0;
    while (true) {
      const idx = contentLower.indexOf(token, searchStart);
      if (idx === -1) break;
      occurrences++;
      searchStart = idx + token.length;
    }
    score += occurrences;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Create the `lookup_process` tool, closing over the full set of loaded
 * process files. Agents call this tool to retrieve relevant procedures
 * for a given situation.
 *
 * @param processes  The complete library of loaded ProcessFile objects.
 * @returns Array containing the lookup_process DynamicStructuredTool.
 */
export function createProcessTools(processes: ProcessFile[]): DynamicStructuredTool[] {
  const lookupProcessTool = new DynamicStructuredTool({
    name: "lookup_process",
    description:
      "Search the process file library for procedures relevant to a situation. " +
      "Returns the top 3 most relevant process files with their full content. " +
      "Use this when you need detailed instructions for handling a specific scenario " +
      "(e.g., 'late delivery', 'driver not responding', 'restaurant tablet issue', " +
      "'wrong order', 'refund policy', 'courier overloaded'). " +
      "You can search by trigger name, situation description, or keywords.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "Description of the situation or keywords to search for " +
          "(e.g. 'late delivery', 'driver_unresponsive', 'credits and refunds', 'restaurant tablet troubleshooting')",
        ),
    }),
    func: async (input) => {
      try {
        const query = input.query.trim();
        if (!query) {
          return JSON.stringify({ error: "Empty query — please describe the situation you need help with." });
        }

        const tokens = tokenize(query);
        if (tokens.length === 0) {
          // If all tokens were stop-words, try the raw query as a single token
          const fallbackTokens = [query.toLowerCase().replace(/[\s\-]+/g, "_")];
          return searchAndFormat(processes, fallbackTokens, query);
        }

        return searchAndFormat(processes, tokens, query);
      } catch (err) {
        log.error({ err, query: input.query }, "lookup_process failed");
        return JSON.stringify({
          error: "Failed to search process files",
          details: String(err),
        });
      }
    },
  });

  return [lookupProcessTool];
}

// ---------------------------------------------------------------------------
// Internal: search + format
// ---------------------------------------------------------------------------

function searchAndFormat(processes: ProcessFile[], tokens: string[], rawQuery: string): string {
  const scored: ScoredProcess[] = processes
    .map((p) => ({ process: p, score: scoreProcess(p, tokens, rawQuery) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return JSON.stringify({
      message: "No matching process files found for your query. Try different keywords or a more specific trigger name.",
      query: rawQuery,
      availableTriggers: [...new Set(processes.map((p) => p.trigger))].sort().slice(0, 20),
    });
  }

  // Take top 3
  const top = scored.slice(0, 3);

  const sections: string[] = [
    `Found ${scored.length} matching process file(s). Showing top ${top.length}:\n`,
  ];

  for (const { process: proc, score } of top) {
    sections.push(
      `--- Process: ${proc.name} ---\n` +
      `Trigger: ${proc.trigger} | Agent: ${proc.agent} | Priority: ${proc.priority} | v${proc.version}\n` +
      `Relevance score: ${score}\n\n` +
      proc.content,
    );
  }

  log.debug(
    { query: rawQuery, matchCount: scored.length, topScores: top.map((t) => t.score) },
    "lookup_process returned %d results",
    top.length,
  );

  return sections.join("\n\n");
}
