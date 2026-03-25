/**
 * Action registry — the single source of truth for all action definitions.
 *
 * Every mutation the AI can perform must be registered here before it can be
 * executed through the guardrails pipeline.
 */

import type { ActionDefinition } from "./types.js";

// ---------------------------------------------------------------------------
// Internal store
// ---------------------------------------------------------------------------

const actions = new Map<string, ActionDefinition<unknown>>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register an action definition. Throws if an action with the same name
 * already exists — duplicate names indicate a wiring bug.
 */
export function defineAction<T>(config: ActionDefinition<T>): void {
  if (actions.has(config.name)) {
    throw new Error(
      `Action "${config.name}" is already registered. Duplicate action names are not allowed.`,
    );
  }
  actions.set(config.name, config as ActionDefinition<unknown>);
}

/**
 * Look up a registered action by name. Returns `undefined` if not found.
 */
export function getAction(name: string): ActionDefinition<unknown> | undefined {
  return actions.get(name);
}

/**
 * Return all registered action definitions as an array.
 */
export function listActions(): ActionDefinition<unknown>[] {
  return Array.from(actions.values());
}

/**
 * Remove all registered actions. Intended for test teardown only.
 * @internal
 */
export function clearActions(): void {
  actions.clear();
}
