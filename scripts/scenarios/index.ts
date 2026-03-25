/**
 * Scenario definitions for the Sisyphus simulation harness.
 *
 * Each scenario sets up a realistic OntologyStore state, then declares a
 * sequence of actions to run through the guardrails executor. The harness
 * validates that each action produces the expected outcome (executed, staged,
 * rejected, cooldown_blocked, etc.).
 */

import type { OntologyStore } from "../../src/ontology/state/store.js";
import type { ActionOutcome } from "../../src/guardrails/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScenarioAction {
  /** Registered action name (e.g. "AssignDriverToOrder"). */
  name: string;
  /** Parameters to pass to executeAction. */
  params: Record<string, unknown>;
  /** Reasoning string for the audit trail. */
  reasoning: string;
  /** The outcome we expect from the guardrails pipeline. */
  expectedOutcome: ActionOutcome;
  /** Short label for the report table. */
  label?: string;
}

export interface Scenario {
  /** Human-readable scenario name. */
  name: string;
  /** What this scenario tests. */
  description: string;
  /** Populate the OntologyStore with scenario-specific data. */
  setup: (store: OntologyStore) => void;
  /** Ordered list of actions to execute. */
  actions: ScenarioAction[];
}

// ---------------------------------------------------------------------------
// Aggregate all scenarios
// ---------------------------------------------------------------------------

import { unassignedOrdersScenario } from "./unassigned-orders.js";
import { driverUnresponsiveScenario } from "./driver-unresponsive.js";
import { ticketFloodScenario } from "./ticket-flood.js";
import { marketSurgeScenario } from "./market-surge.js";
import { happyPathScenario } from "./happy-path.js";
import { lateDeliveryChainScenario } from "./late-delivery-chain.js";
import { shiftTransitionScenario } from "./shift-transition.js";

export const ALL_SCENARIOS: Scenario[] = [
  unassignedOrdersScenario,
  driverUnresponsiveScenario,
  ticketFloodScenario,
  marketSurgeScenario,
  happyPathScenario,
  lateDeliveryChainScenario,
  shiftTransitionScenario,
];
