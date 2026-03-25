/**
 * Submission criteria validator.
 *
 * Runs every criterion defined on an action against the provided params and
 * world state. Returns a ValidationResult indicating pass/fail with details.
 */

import type {
  ActionDefinition,
  ValidationError,
  ValidationResult,
} from "./types.js";

/**
 * Validate all submission criteria for an action.
 *
 * Each criterion is a pure function `(params, state) => { passed, message? }`.
 * All criteria are evaluated (not short-circuited) so the caller gets a
 * complete list of failures in one pass.
 */
export function validateSubmissionCriteria(
  action: ActionDefinition<unknown>,
  params: Record<string, unknown>,
  state: Record<string, unknown>,
): ValidationResult {
  const errors: ValidationError[] = [];

  for (const criterion of action.criteria) {
    try {
      const result = criterion.check(params, state);
      if (!result.passed) {
        errors.push({
          rule: criterion.name,
          message: result.message ?? `Submission criterion "${criterion.name}" failed`,
        });
      }
    } catch (err) {
      // A criterion that throws is treated as a failure — fail closed.
      errors.push({
        rule: criterion.name,
        message: `Criterion "${criterion.name}" threw an error: ${
          err instanceof Error ? err.message : String(err)
        }`,
        context: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  return { passed: errors.length === 0, errors };
}
