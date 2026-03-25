// Shadow mode — proposals instead of real execution.
//
// When OPERATING_MODE=shadow, Sisyphus runs the full agent pipeline but
// records every action as a "proposal" for human review instead of executing
// real side effects.

export { ShadowExecutor, type Proposal, type OnProposalCallback } from "./executor.js";
export { ProposalStore, type ProposalStats } from "./proposal-store.js";
export {
  ShadowMetrics,
  type ShadowSummary,
  type AccuracyReport,
  type ReviewedProposal,
} from "./metrics.js";
