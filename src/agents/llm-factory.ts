/**
 * ChatOpenAI factory for the Sisyphus agent graph.
 *
 * Creates LangChain ChatOpenAI instances pre-configured with the
 * project's env vars. Supports routing "complex_reasoning" and
 * "escalation_decision" tasks to the fallback (cloud) model while
 * using the primary (local) model for everything else.
 *
 * @see src/config/env.ts
 * @see src/llm/models.ts — TaskType definitions
 */

import { ChatOpenAI } from "@langchain/openai";
import { env } from "../config/env.js";
import type { TaskType } from "../llm/models.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ChatOpenAI instance configured for the given task type.
 *
 * @param taskType  Optional task classifier. When set to
 *                  "complex_reasoning" or "escalation_decision" the
 *                  instance targets the fallback (cloud) endpoint.
 *                  All other values (or undefined) target the primary
 *                  (local) endpoint.
 * @returns A ready-to-use ChatOpenAI instance.
 */
export function createChatModel(taskType?: TaskType): ChatOpenAI {
  const useFallback =
    taskType === "complex_reasoning" || taskType === "escalation_decision";

  const hasFallback = Boolean(env.LLM_FALLBACK_URL && env.LLM_FALLBACK_API_KEY);

  if (useFallback && hasFallback) {
    return new ChatOpenAI({
      model: env.LLM_FALLBACK_MODEL ?? env.LLM_MODEL,
      apiKey: env.LLM_FALLBACK_API_KEY,
      configuration: { baseURL: env.LLM_FALLBACK_URL },
      temperature: 0.1,
    });
  }

  return new ChatOpenAI({
    model: env.LLM_MODEL,
    apiKey: env.LLM_API_KEY,
    configuration: {
      baseURL: env.LLM_BASE_URL,
      defaultHeaders: {
        "HTTP-Referer": "https://valleyeats.ca",
        "X-Title": "Sisyphus AI Dispatcher",
      },
    },
    temperature: 0.1,
  });
}
