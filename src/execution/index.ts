// Execution layer — translates ontology actions into real-world effects.
//
// The execution layer sits beneath the guardrails pipeline. After an action
// passes validation, cooldown, rate limit, and autonomy checks, it arrives
// here to be executed via browser automation or direct API call.
//
// @see planning/09-ontology-layer-design.md section 8

// Shared types
export type { ExecutionMethod, ExecutionResult, ActionExecutor } from "./types.js";

// Router
export { ExecutionRouter } from "./router.js";

// Browser executor
export {
  connectBrowser,
  createDispatchPage,
  disconnectBrowser,
  authenticateDispatch,
  BrowserExecutor,
} from "./browser/index.js";

// API executor
export { DispatchApiWriter, type ApiWriteResult, ApiExecutor } from "./api/index.js";
