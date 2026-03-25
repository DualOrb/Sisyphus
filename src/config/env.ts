import { z } from "zod";
import "dotenv/config";

const envSchema = z.object({
  // LLM
  LLM_BASE_URL: z.string().url(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  LLM_FALLBACK_URL: z.string().url().optional(),
  LLM_FALLBACK_API_KEY: z.string().optional(),
  LLM_FALLBACK_MODEL: z.string().optional(),

  // Dispatch
  DISPATCH_API_URL: z.string().url(),
  DISPATCH_WS_URL: z.string().url(),
  DISPATCH_USERNAME: z.string().min(1),
  DISPATCH_PASSWORD: z.string().min(1),
  DISPATCH_ADAPTER: z.enum(["old-dispatch", "new-dispatch"]).default("old-dispatch"),

  // AWS
  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  SECRETS_ARN: z.string().default("vendorportal/credentials"),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379/0"),

  // PostgreSQL
  POSTGRES_URL: z.string().default("postgresql://sisyphus:sisyphus@localhost:5432/sisyphus"),

  // Temporal
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  TEMPORAL_TASK_QUEUE: z.string().default("sisyphus-workers"),

  // Chrome
  CHROME_CDP_URL: z.string().default("ws://localhost:9222"),

  // Business Hours
  BUSINESS_HOURS_START: z.string().default("09:00"),
  BUSINESS_HOURS_END: z.string().default("22:00"),
  BUSINESS_TIMEZONE: z.string().default("America/Edmonton"),

  // Observability
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().default("sisyphus"),

  // Operating mode
  OPERATING_MODE: z.enum(["shadow", "supervised", "autonomous"]).default("shadow"),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.format();
    const missing = Object.entries(formatted)
      .filter(([key, val]) => key !== "_errors" && val && typeof val === "object" && "_errors" in val)
      .map(([key, val]) => `  ${key}: ${(val as { _errors: string[] })._errors.join(", ")}`)
      .join("\n");

    throw new Error(`Missing or invalid environment variables:\n${missing}`);
  }

  return result.data;
}

export const env = loadEnv();
