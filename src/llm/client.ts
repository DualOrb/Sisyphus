import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { env } from "../config/env.js";
import { createChildLogger } from "../lib/logger.js";
import { TokenTracker } from "./token-tracker.js";

const log = createChildLogger("llm");

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const primaryClient = new OpenAI({
  baseURL: env.LLM_BASE_URL,
  apiKey: env.LLM_API_KEY,
});

const fallbackClient =
  env.LLM_FALLBACK_URL && env.LLM_FALLBACK_API_KEY
    ? new OpenAI({
        baseURL: env.LLM_FALLBACK_URL,
        apiKey: env.LLM_FALLBACK_API_KEY,
      })
    : null;

// ---------------------------------------------------------------------------
// Shared token tracker (one per process, reset at shift boundaries)
// ---------------------------------------------------------------------------

export const tokenTracker = new TokenTracker();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CallLlmOptions {
  /** Override the model id for this call. */
  model?: string;
  /** Tool definitions to pass to the model. */
  tools?: ChatCompletionTool[];
  /** Sampling temperature (0-2). */
  temperature?: number;
  /** Maximum tokens to generate. */
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Core call function
// ---------------------------------------------------------------------------

const PRIMARY_TIMEOUT_MS = 30_000;

/**
 * Call the LLM with automatic fallback.
 *
 * 1. Tries the primary (local) client with a 30 s timeout.
 * 2. On connection error or timeout, retries via the fallback (cloud) client.
 * 3. Records token usage for cost tracking.
 */
export async function callLlm(
  messages: ChatCompletionMessageParam[],
  options: CallLlmOptions = {},
) {
  const primaryModel = options.model ?? env.LLM_MODEL;

  try {
    log.debug({ model: primaryModel }, "calling primary LLM");

    const response = await primaryClient.chat.completions.create(
      {
        model: primaryModel,
        messages,
        ...(options.tools && { tools: options.tools }),
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
      },
      { timeout: PRIMARY_TIMEOUT_MS },
    );

    const usage = response.usage;
    if (usage) {
      tokenTracker.record(primaryModel, usage.prompt_tokens, usage.completion_tokens);
    }

    log.info({ model: primaryModel, tokens: usage }, "primary LLM responded");
    return response;
  } catch (err) {
    if (!fallbackClient) {
      throw err;
    }

    if (!isRetryableError(err)) {
      throw err;
    }

    log.warn({ err, model: primaryModel }, "primary LLM failed, trying fallback");

    const fallbackModel = options.model ?? env.LLM_FALLBACK_MODEL ?? env.LLM_MODEL;

    const response = await fallbackClient.chat.completions.create({
      model: fallbackModel,
      messages,
      ...(options.tools && { tools: options.tools }),
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
    });

    const usage = response.usage;
    if (usage) {
      tokenTracker.record(fallbackModel, usage.prompt_tokens, usage.completion_tokens);
    }

    log.info({ model: fallbackModel, tokens: usage }, "fallback LLM responded");
    return response;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRetryableError(err: unknown): boolean {
  if (err instanceof OpenAI.APIConnectionError) return true;
  if (err instanceof OpenAI.APIConnectionTimeoutError) return true;

  // Generic timeout / network errors
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("timeout") || msg.includes("econnrefused") || msg.includes("econnreset")) {
      return true;
    }
  }

  return false;
}
