import { env } from "../config/env.js";

export interface ModelConfig {
  id: string;
  provider: "local" | "openrouter";
  maxContextTokens: number;
  costPerMillionInput?: number;
  costPerMillionOutput?: number;
}

/**
 * Known model configurations keyed by model ID.
 * Extend this map as new models are added.
 */
export const knownModels: Record<string, ModelConfig> = {
  // Local models (llama.cpp or similar)
  "local-default": {
    id: env.LLM_MODEL,
    provider: "local",
    maxContextTokens: 8192,
    costPerMillionInput: 0,
    costPerMillionOutput: 0,
  },

  // Cloud fallback models (OpenRouter)
  "cloud-fallback": {
    id: env.LLM_FALLBACK_MODEL ?? "anthropic/claude-sonnet-4",
    provider: "openrouter",
    maxContextTokens: 200_000,
    costPerMillionInput: 3.0,
    costPerMillionOutput: 15.0,
  },
};

export type TaskType =
  | "monitoring"
  | "messaging"
  | "ticket_resolution"
  | "complex_reasoning"
  | "escalation_decision";

const taskModelMap: Record<TaskType, string> = {
  monitoring: "local-default",
  messaging: "local-default",
  ticket_resolution: "local-default",
  complex_reasoning: "cloud-fallback",
  escalation_decision: "cloud-fallback",
};

/**
 * Returns the recommended ModelConfig for a given task type.
 */
export function getModelForTask(taskType: TaskType): ModelConfig {
  const key = taskModelMap[taskType];
  return knownModels[key];
}
