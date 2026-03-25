/**
 * New dispatch authentication — re-exports from existing browser auth module.
 *
 * The new dispatch (React/AWS) uses the same Cognito flow that's already
 * implemented in `execution/browser/auth.ts`.
 */

export { authenticateDispatch } from "../../execution/browser/auth.js";
