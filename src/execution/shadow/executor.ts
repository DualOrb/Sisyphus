/**
 * Shadow executor — replaces real execution when OPERATING_MODE=shadow.
 *
 * The full agent pipeline runs (ontology sync → agent reasoning → action
 * selection → guardrails validation) but actions are NOT executed against
 * real systems. Instead, everything is logged as a "proposal" that humans
 * can review to assess decision quality.
 *
 * @see planning/09-ontology-layer-design.md
 */

import { randomUUID } from "node:crypto";
import { createChildLogger } from "../../lib/logger.js";
import type { ActionExecutor, ExecutionResult } from "../types.js";

const log = createChildLogger("execution:shadow");

// ---------------------------------------------------------------------------
// Proposal type
// ---------------------------------------------------------------------------

export interface Proposal {
  /** Unique proposal identifier. */
  id: string;
  /** When the proposal was created. */
  timestamp: Date;
  /** The action that was proposed. */
  actionName: string;
  /** Parameters that would have been sent to the real executor. */
  params: Record<string, unknown>;
  /** Autonomy tier of the action. */
  tier: string;
  /** Which executor would have handled this action in real mode. */
  wouldExecuteVia: "browser" | "api" | "internal";
  /** Agent's reasoning for proposing this action. */
  reasoning?: string;
  /** Which agent proposed this action. */
  agentId?: string;
  /** Result from guardrails validation (if available). */
  validationResult?: {
    passed: boolean;
    errors?: Array<{ rule: string; message: string }>;
  };
}

export type OnProposalCallback = (proposal: Proposal) => void | Promise<void>;

// ---------------------------------------------------------------------------
// ShadowExecutor
// ---------------------------------------------------------------------------

export class ShadowExecutor implements ActionExecutor {
  private readonly proposals: Proposal[] = [];
  private onProposal?: OnProposalCallback;

  /**
   * Map of action names → the execution method that WOULD be used.
   * Populated by the router so the shadow executor can log the right method.
   */
  private readonly methodMap = new Map<string, "browser" | "api" | "internal">();

  /**
   * Contextual metadata attached to the next execute() call.
   * Set via `setContext()` before calling `execute()`.
   */
  private pendingContext: {
    tier?: string;
    reasoning?: string;
    agentId?: string;
    validationResult?: Proposal["validationResult"];
  } = {};

  constructor(onProposal?: OnProposalCallback) {
    this.onProposal = onProposal;
  }

  /**
   * Register the execution method for an action so proposals can record
   * what WOULD have happened.
   */
  setMethodForAction(actionName: string, method: "browser" | "api" | "internal"): void {
    this.methodMap.set(actionName, method);
  }

  /**
   * Set contextual metadata for the next proposal.
   * Called by the execution pipeline before `execute()`.
   */
  setContext(ctx: {
    tier?: string;
    reasoning?: string;
    agentId?: string;
    validationResult?: Proposal["validationResult"];
  }): void {
    this.pendingContext = ctx;
  }

  /**
   * "Execute" an action in shadow mode — records a proposal instead of
   * performing real side effects.
   */
  async execute(
    actionName: string,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const start = Date.now();

    const proposal: Proposal = {
      id: randomUUID(),
      timestamp: new Date(),
      actionName,
      params,
      tier: this.pendingContext.tier ?? "UNKNOWN",
      wouldExecuteVia: this.methodMap.get(actionName) ?? "internal",
      reasoning: this.pendingContext.reasoning,
      agentId: this.pendingContext.agentId,
      validationResult: this.pendingContext.validationResult,
    };

    // Reset pending context after consuming it
    this.pendingContext = {};

    this.proposals.push(proposal);

    log.info(
      {
        proposalId: proposal.id,
        actionName,
        wouldExecuteVia: proposal.wouldExecuteVia,
        tier: proposal.tier,
      },
      "Shadow proposal recorded (no real execution)",
    );

    // Invoke optional callback
    if (this.onProposal) {
      await this.onProposal(proposal);
    }

    const duration = Date.now() - start;

    return {
      success: true,
      method: "shadow",
      duration,
      data: {
        proposalId: proposal.id,
        note: `Shadow mode: "${actionName}" would have executed via ${proposal.wouldExecuteVia}`,
      },
    };
  }

  /** Return all proposals recorded so far this shift. */
  getProposals(): readonly Proposal[] {
    return [...this.proposals];
  }

  /** Clear all proposals (e.g. at the start of a new shift). */
  clearProposals(): void {
    this.proposals.length = 0;
  }
}
