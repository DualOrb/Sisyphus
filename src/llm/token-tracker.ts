import { knownModels } from "./models.js";

interface ModelUsage {
  input: number;
  output: number;
}

export interface UsageSummary {
  totalInput: number;
  totalOutput: number;
  byModel: Record<string, ModelUsage>;
}

/**
 * Accumulates token usage per model for a session / shift window.
 */
export class TokenTracker {
  private usage: Record<string, ModelUsage> = {};

  /** Record token counts for a single LLM call. */
  record(model: string, inputTokens: number, outputTokens: number): void {
    const entry = this.usage[model] ?? { input: 0, output: 0 };
    entry.input += inputTokens;
    entry.output += outputTokens;
    this.usage[model] = entry;
  }

  /** Aggregate summary of all recorded usage. */
  getSummary(): UsageSummary {
    let totalInput = 0;
    let totalOutput = 0;

    for (const entry of Object.values(this.usage)) {
      totalInput += entry.input;
      totalOutput += entry.output;
    }

    return {
      totalInput,
      totalOutput,
      byModel: { ...this.usage },
    };
  }

  /** Estimated cost in USD based on known model configs. */
  estimateCost(): number {
    let cost = 0;

    for (const [model, entry] of Object.entries(this.usage)) {
      // Try to find model config by matching the model id
      const config = Object.values(knownModels).find((m) => m.id === model);

      const inputRate = config?.costPerMillionInput ?? 0;
      const outputRate = config?.costPerMillionOutput ?? 0;

      cost += (entry.input / 1_000_000) * inputRate;
      cost += (entry.output / 1_000_000) * outputRate;
    }

    return cost;
  }

  /** Reset all counters (e.g. at shift boundaries). */
  reset(): void {
    this.usage = {};
  }
}
