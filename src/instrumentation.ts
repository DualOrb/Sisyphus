/**
 * OpenTelemetry + Langfuse instrumentation bootstrap.
 *
 * MUST be imported before any LangChain / LangGraph imports so the
 * OTel SDK can hook into the runtime before spans are emitted.
 *
 * When LANGFUSE_ENABLED !== "true", nothing is initialised and the
 * module is effectively a no-op (zero overhead).
 *
 * Usage (entry-point files):
 *   import "./instrumentation.js";   // FIRST import
 *   import { ... } from "@langchain/...";
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { createChildLogger } from "./lib/logger.js";

const log = createChildLogger("instrumentation");

const langfuseEnabled = process.env.LANGFUSE_ENABLED === "true";

let spanProcessor: LangfuseSpanProcessor | undefined;

if (langfuseEnabled) {
  spanProcessor = new LangfuseSpanProcessor();

  const sdk = new NodeSDK({ spanProcessors: [spanProcessor] });
  sdk.start();

  log.info(
    { baseUrl: process.env.LANGFUSE_BASE_URL ?? "http://localhost:3100" },
    "Langfuse tracing enabled",
  );
} else {
  log.debug("Langfuse tracing disabled (LANGFUSE_ENABLED !== true)");
}

export { spanProcessor };
