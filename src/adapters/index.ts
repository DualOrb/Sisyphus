/**
 * Dispatch adapter layer — top-level barrel export.
 *
 * Provides a unified interface for Sisyphus to talk to either the old PHP
 * dispatch (dispatch.valleyeats.ca) or the new React/AWS dispatch, without
 * any consumer needing to know which one is active.
 */

// Types
export type {
  DispatchAdapter,
  ApiResult,
  AdapterType,
  OntologySyncSource,
} from "./types.js";

// Factory
export {
  createDispatchAdapter,
  createDispatchAdapterFromEnv,
} from "./factory.js";
export type {
  OldDispatchConfig,
  NewDispatchConfig,
  AdapterConfig,
} from "./factory.js";

// Concrete adapters (for cases where callers need the specific type)
export { OldDispatchClient } from "./old-dispatch/index.js";
export { NewDispatchClient } from "./new-dispatch/index.js";
