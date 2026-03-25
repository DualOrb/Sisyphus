/**
 * Shadow mode metrics tracker.
 *
 * Aggregates per-shift statistics about proposals generated in shadow mode
 * so operators can evaluate Sisyphus's decision quality over time.
 */

import type { Proposal } from "./executor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShadowSummary {
  totalProposals: number;
  byAction: Record<string, number>;
  byTier: Record<string, number>;
  byValidation: { passed: number; failed: number };
  byAgent: Record<string, number>;
  byMethod: Record<string, number>;
}

export interface AccuracyReport {
  totalReviewed: number;
  agreed: number;
  disagreed: number;
  agreeRate: number;
  disagreeRate: number;
  byAction: Record<string, { agreed: number; disagreed: number; agreeRate: number }>;
}

export interface ReviewedProposal {
  proposalId: string;
  actionName: string;
  humanDecision: "agree" | "disagree";
}

// ---------------------------------------------------------------------------
// ShadowMetrics
// ---------------------------------------------------------------------------

export class ShadowMetrics {
  private totalProposals = 0;
  private byAction = new Map<string, number>();
  private byTier = new Map<string, number>();
  private validationPassed = 0;
  private validationFailed = 0;
  private byAgent = new Map<string, number>();
  private byMethod = new Map<string, number>();
  private reviews: ReviewedProposal[] = [];

  /** Record a new proposal into the metrics. */
  record(proposal: Proposal): void {
    this.totalProposals++;

    // By action
    this.byAction.set(
      proposal.actionName,
      (this.byAction.get(proposal.actionName) ?? 0) + 1,
    );

    // By tier
    this.byTier.set(
      proposal.tier,
      (this.byTier.get(proposal.tier) ?? 0) + 1,
    );

    // By validation result
    if (proposal.validationResult) {
      if (proposal.validationResult.passed) {
        this.validationPassed++;
      } else {
        this.validationFailed++;
      }
    }

    // By agent
    if (proposal.agentId) {
      this.byAgent.set(
        proposal.agentId,
        (this.byAgent.get(proposal.agentId) ?? 0) + 1,
      );
    }

    // By method
    this.byMethod.set(
      proposal.wouldExecuteVia,
      (this.byMethod.get(proposal.wouldExecuteVia) ?? 0) + 1,
    );
  }

  /** Record a human review decision. */
  recordReview(review: ReviewedProposal): void {
    this.reviews.push(review);
  }

  /** Get a formatted summary of all metrics. */
  getSummary(): ShadowSummary {
    return {
      totalProposals: this.totalProposals,
      byAction: Object.fromEntries(this.byAction),
      byTier: Object.fromEntries(this.byTier),
      byValidation: {
        passed: this.validationPassed,
        failed: this.validationFailed,
      },
      byAgent: Object.fromEntries(this.byAgent),
      byMethod: Object.fromEntries(this.byMethod),
    };
  }

  /**
   * Compute an accuracy report based on human review decisions.
   * Only includes proposals that have been reviewed.
   */
  getAccuracyReport(): AccuracyReport {
    const totalReviewed = this.reviews.length;
    const agreed = this.reviews.filter((r) => r.humanDecision === "agree").length;
    const disagreed = this.reviews.filter((r) => r.humanDecision === "disagree").length;

    // Per-action breakdown
    const actionBuckets = new Map<string, { agreed: number; disagreed: number }>();
    for (const review of this.reviews) {
      if (!actionBuckets.has(review.actionName)) {
        actionBuckets.set(review.actionName, { agreed: 0, disagreed: 0 });
      }
      const bucket = actionBuckets.get(review.actionName)!;
      if (review.humanDecision === "agree") {
        bucket.agreed++;
      } else {
        bucket.disagreed++;
      }
    }

    const byAction: AccuracyReport["byAction"] = {};
    for (const [actionName, bucket] of actionBuckets) {
      const total = bucket.agreed + bucket.disagreed;
      byAction[actionName] = {
        agreed: bucket.agreed,
        disagreed: bucket.disagreed,
        agreeRate: total > 0 ? bucket.agreed / total : 0,
      };
    }

    return {
      totalReviewed,
      agreed,
      disagreed,
      agreeRate: totalReviewed > 0 ? agreed / totalReviewed : 0,
      disagreeRate: totalReviewed > 0 ? disagreed / totalReviewed : 0,
      byAction,
    };
  }

  /** Reset all metrics for a new shift. */
  reset(): void {
    this.totalProposals = 0;
    this.byAction.clear();
    this.byTier.clear();
    this.validationPassed = 0;
    this.validationFailed = 0;
    this.byAgent.clear();
    this.byMethod.clear();
    this.reviews = [];
  }
}
