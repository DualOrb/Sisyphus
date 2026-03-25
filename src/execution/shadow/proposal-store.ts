/**
 * Persistent proposal storage backed by PostgreSQL.
 *
 * Saves shadow-mode proposals to the `shadow_proposals` table so operators
 * can review Sisyphus's decisions across shifts and compute accuracy metrics.
 */

import { eq, sql, desc, and } from "drizzle-orm";
import { shadowProposals } from "../../../db/schema.js";
import type { PostgresDb } from "../../memory/postgres/client.js";
import type { Proposal } from "./executor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProposalStats {
  byAction: Record<string, number>;
  byTier: Record<string, number>;
  byMethod: Record<string, number>;
  total: number;
}

// ---------------------------------------------------------------------------
// ProposalStore
// ---------------------------------------------------------------------------

export class ProposalStore {
  constructor(private readonly db: PostgresDb) {}

  /** Insert a proposal into the database. */
  async saveProposal(proposal: Proposal): Promise<void> {
    await this.db.insert(shadowProposals).values({
      id: proposal.id,
      shiftDate: new Date().toISOString().slice(0, 10),
      timestamp: proposal.timestamp,
      actionName: proposal.actionName,
      params: proposal.params,
      tier: proposal.tier,
      wouldExecuteVia: proposal.wouldExecuteVia,
      reasoning: proposal.reasoning ?? null,
      agentId: proposal.agentId ?? null,
      validationPassed: proposal.validationResult?.passed ?? null,
      validationErrors: proposal.validationResult?.errors ?? null,
    });
  }

  /** Retrieve proposals, optionally filtered by shift date (YYYY-MM-DD). */
  async getProposals(shiftDate?: string): Promise<(typeof shadowProposals.$inferSelect)[]> {
    if (shiftDate) {
      return this.db
        .select()
        .from(shadowProposals)
        .where(eq(shadowProposals.shiftDate, shiftDate))
        .orderBy(desc(shadowProposals.timestamp));
    }
    return this.db
      .select()
      .from(shadowProposals)
      .orderBy(desc(shadowProposals.timestamp));
  }

  /** Retrieve proposals for a specific action name. */
  async getProposalsByAction(actionName: string): Promise<(typeof shadowProposals.$inferSelect)[]> {
    return this.db
      .select()
      .from(shadowProposals)
      .where(eq(shadowProposals.actionName, actionName))
      .orderBy(desc(shadowProposals.timestamp));
  }

  /** Aggregate counts by action, tier, and would-execute-via method. */
  async getProposalStats(shiftDate?: string): Promise<ProposalStats> {
    const whereClause = shiftDate
      ? eq(shadowProposals.shiftDate, shiftDate)
      : undefined;

    // Fetch all matching proposals and aggregate in-memory.
    // For production scale, this could be replaced with SQL GROUP BY queries.
    const rows = whereClause
      ? await this.db.select().from(shadowProposals).where(whereClause)
      : await this.db.select().from(shadowProposals);

    const byAction: Record<string, number> = {};
    const byTier: Record<string, number> = {};
    const byMethod: Record<string, number> = {};

    for (const row of rows) {
      byAction[row.actionName] = (byAction[row.actionName] ?? 0) + 1;
      byTier[row.tier] = (byTier[row.tier] ?? 0) + 1;
      byMethod[row.wouldExecuteVia] = (byMethod[row.wouldExecuteVia] ?? 0) + 1;
    }

    return { byAction, byTier, byMethod, total: rows.length };
  }

  /** Mark a proposal as reviewed by a human. */
  async markReviewed(
    proposalId: string,
    humanDecision: "agree" | "disagree",
    humanNote?: string,
  ): Promise<void> {
    await this.db
      .update(shadowProposals)
      .set({
        humanDecision,
        humanNote: humanNote ?? null,
        reviewedAt: new Date(),
      })
      .where(eq(shadowProposals.id, proposalId));
  }
}
