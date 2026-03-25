/**
 * Adapter factory — creates the appropriate DispatchAdapter based on config.
 *
 * Reads the `DISPATCH_ADAPTER` env var to determine which implementation to
 * instantiate. Defaults to "old-dispatch" since that's the live system.
 *
 * Usage:
 *   const adapter = createDispatchAdapter();
 */

import { createChildLogger } from "../lib/logger.js";
import type { AdapterType, DispatchAdapter } from "./types.js";
import { OldDispatchClient } from "./old-dispatch/index.js";
import { NewDispatchClient } from "./new-dispatch/index.js";

const log = createChildLogger("adapters:factory");

// ---------------------------------------------------------------------------
// Config shape for each adapter type
// ---------------------------------------------------------------------------

export interface OldDispatchConfig {
  baseUrl: string;
  username: string;
  password: string;
  sessionCookie?: string;
}

export interface NewDispatchConfig {
  baseUrl: string;
  authToken: string;
  dispatchUrl: string;
  username: string;
  password: string;
}

export type AdapterConfig =
  | { type: "old-dispatch"; config: OldDispatchConfig }
  | { type: "new-dispatch"; config: NewDispatchConfig };

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a DispatchAdapter from explicit config.
 */
export function createDispatchAdapter(adapterConfig: AdapterConfig): DispatchAdapter {
  const { type, config } = adapterConfig;

  log.info({ adapterType: type }, `Creating dispatch adapter: ${type}`);

  switch (type) {
    case "old-dispatch":
      return new OldDispatchClient(config);

    case "new-dispatch":
      return new NewDispatchClient(config);

    default: {
      // Exhaustiveness check
      const _never: never = type;
      throw new Error(`Unknown adapter type: ${_never}`);
    }
  }
}

/**
 * Create a DispatchAdapter using environment variables.
 *
 * Reads `DISPATCH_ADAPTER` to pick the type, then pulls the relevant
 * connection details from the env.
 */
export function createDispatchAdapterFromEnv(envVars: {
  DISPATCH_ADAPTER?: string;
  DISPATCH_API_URL: string;
  DISPATCH_USERNAME: string;
  DISPATCH_PASSWORD: string;
  // Optional — only needed for new-dispatch
  DISPATCH_WS_URL?: string;
}): DispatchAdapter {
  const adapterType = (envVars.DISPATCH_ADAPTER ?? "old-dispatch") as AdapterType;

  log.info(
    { adapterType, apiUrl: envVars.DISPATCH_API_URL },
    `Creating dispatch adapter from env: ${adapterType}`,
  );

  switch (adapterType) {
    case "old-dispatch":
      return new OldDispatchClient({
        baseUrl: envVars.DISPATCH_API_URL,
        username: envVars.DISPATCH_USERNAME,
        password: envVars.DISPATCH_PASSWORD,
      });

    case "new-dispatch":
      // For the new dispatch, DISPATCH_API_URL is both the API base and the
      // browser URL (or a separate env var could be introduced later).
      return new NewDispatchClient({
        baseUrl: envVars.DISPATCH_API_URL,
        authToken: "", // Will be set after browser login extracts the token
        dispatchUrl: envVars.DISPATCH_API_URL,
        username: envVars.DISPATCH_USERNAME,
        password: envVars.DISPATCH_PASSWORD,
      });

    default:
      throw new Error(
        `Unknown DISPATCH_ADAPTER value: "${adapterType}". Expected "old-dispatch" or "new-dispatch".`,
      );
  }
}
