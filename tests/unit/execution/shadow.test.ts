/**
 * Unit tests for the Sisyphus shadow mode system.
 *
 * Covers: ShadowExecutor, ShadowMetrics, accuracy reports.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ShadowExecutor, type Proposal } from "@execution/shadow/executor";
import { ShadowMetrics, type ReviewedProposal } from "@execution/shadow/metrics";

// ---------------------------------------------------------------------------
// ShadowExecutor
// ---------------------------------------------------------------------------

describe("ShadowExecutor", () => {
  let executor: ShadowExecutor;

  beforeEach(() => {
    executor = new ShadowExecutor();
  });

  it("always returns success with method 'shadow'", async () => {
    const result = await executor.execute("AssignDriverToOrder", {
      orderId: "order-1",
      driverId: "driver-1",
    });

    expect(result.success).toBe(true);
    expect(result.method).toBe("shadow");
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.data).toBeDefined();
    expect((result.data as Record<string, unknown>).proposalId).toBeDefined();
  });

  it("records proposals with correct fields", async () => {
    executor.setMethodForAction("AssignDriverToOrder", "browser");
    executor.setContext({
      tier: "GREEN",
      reasoning: "Driver is closest",
      agentId: "dispatch-agent",
      validationResult: { passed: true, errors: [] },
    });

    await executor.execute("AssignDriverToOrder", {
      orderId: "order-1",
      driverId: "driver-1",
    });

    const proposals = executor.getProposals();
    expect(proposals).toHaveLength(1);

    const proposal = proposals[0];
    expect(proposal.id).toBeDefined();
    expect(proposal.timestamp).toBeInstanceOf(Date);
    expect(proposal.actionName).toBe("AssignDriverToOrder");
    expect(proposal.params).toEqual({ orderId: "order-1", driverId: "driver-1" });
    expect(proposal.tier).toBe("GREEN");
    expect(proposal.wouldExecuteVia).toBe("browser");
    expect(proposal.reasoning).toBe("Driver is closest");
    expect(proposal.agentId).toBe("dispatch-agent");
    expect(proposal.validationResult).toEqual({ passed: true, errors: [] });
  });

  it("defaults wouldExecuteVia to 'internal' when no method registered", async () => {
    await executor.execute("SomeInternalAction", {});

    const proposals = executor.getProposals();
    expect(proposals[0].wouldExecuteVia).toBe("internal");
  });

  it("defaults tier to 'UNKNOWN' when no context set", async () => {
    await executor.execute("SomeAction", {});

    const proposals = executor.getProposals();
    expect(proposals[0].tier).toBe("UNKNOWN");
  });

  it("accumulates multiple proposals", async () => {
    await executor.execute("Action1", { a: 1 });
    await executor.execute("Action2", { b: 2 });
    await executor.execute("Action3", { c: 3 });

    expect(executor.getProposals()).toHaveLength(3);
  });

  it("clears proposals for new shift", async () => {
    await executor.execute("Action1", {});
    await executor.execute("Action2", {});
    expect(executor.getProposals()).toHaveLength(2);

    executor.clearProposals();
    expect(executor.getProposals()).toHaveLength(0);
  });

  it("invokes the onProposal callback", async () => {
    const callback = vi.fn();
    const executorWithCallback = new ShadowExecutor(callback);

    executorWithCallback.setMethodForAction("TestAction", "api");
    executorWithCallback.setContext({ tier: "YELLOW" });

    await executorWithCallback.execute("TestAction", { x: 1 });

    expect(callback).toHaveBeenCalledTimes(1);
    const proposal = callback.mock.calls[0][0] as Proposal;
    expect(proposal.actionName).toBe("TestAction");
    expect(proposal.wouldExecuteVia).toBe("api");
    expect(proposal.tier).toBe("YELLOW");
  });

  it("resets pending context after each execution", async () => {
    executor.setContext({ tier: "RED", agentId: "agent-1" });
    await executor.execute("Action1", {});

    // Second call without setContext should use defaults
    await executor.execute("Action2", {});

    const proposals = executor.getProposals();
    expect(proposals[0].tier).toBe("RED");
    expect(proposals[0].agentId).toBe("agent-1");
    expect(proposals[1].tier).toBe("UNKNOWN");
    expect(proposals[1].agentId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ShadowMetrics
// ---------------------------------------------------------------------------

describe("ShadowMetrics", () => {
  let metrics: ShadowMetrics;

  beforeEach(() => {
    metrics = new ShadowMetrics();
  });

  function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
    return {
      id: `proposal-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date(),
      actionName: "AssignDriverToOrder",
      params: {},
      tier: "GREEN",
      wouldExecuteVia: "browser",
      reasoning: "test",
      agentId: "dispatch-agent",
      validationResult: { passed: true, errors: [] },
      ...overrides,
    };
  }

  it("tracks total proposals", () => {
    metrics.record(makeProposal());
    metrics.record(makeProposal());
    metrics.record(makeProposal());

    const summary = metrics.getSummary();
    expect(summary.totalProposals).toBe(3);
  });

  it("tracks counts by action name", () => {
    metrics.record(makeProposal({ actionName: "AssignDriverToOrder" }));
    metrics.record(makeProposal({ actionName: "AssignDriverToOrder" }));
    metrics.record(makeProposal({ actionName: "SendDriverMessage" }));

    const summary = metrics.getSummary();
    expect(summary.byAction["AssignDriverToOrder"]).toBe(2);
    expect(summary.byAction["SendDriverMessage"]).toBe(1);
  });

  it("tracks counts by tier", () => {
    metrics.record(makeProposal({ tier: "GREEN" }));
    metrics.record(makeProposal({ tier: "GREEN" }));
    metrics.record(makeProposal({ tier: "YELLOW" }));
    metrics.record(makeProposal({ tier: "RED" }));

    const summary = metrics.getSummary();
    expect(summary.byTier["GREEN"]).toBe(2);
    expect(summary.byTier["YELLOW"]).toBe(1);
    expect(summary.byTier["RED"]).toBe(1);
  });

  it("tracks validation pass/fail", () => {
    metrics.record(makeProposal({ validationResult: { passed: true, errors: [] } }));
    metrics.record(makeProposal({ validationResult: { passed: true, errors: [] } }));
    metrics.record(
      makeProposal({
        validationResult: {
          passed: false,
          errors: [{ rule: "distance", message: "Too far" }],
        },
      }),
    );

    const summary = metrics.getSummary();
    expect(summary.byValidation.passed).toBe(2);
    expect(summary.byValidation.failed).toBe(1);
  });

  it("tracks counts by agent", () => {
    metrics.record(makeProposal({ agentId: "dispatch-agent" }));
    metrics.record(makeProposal({ agentId: "dispatch-agent" }));
    metrics.record(makeProposal({ agentId: "support-agent" }));

    const summary = metrics.getSummary();
    expect(summary.byAgent["dispatch-agent"]).toBe(2);
    expect(summary.byAgent["support-agent"]).toBe(1);
  });

  it("tracks counts by execution method", () => {
    metrics.record(makeProposal({ wouldExecuteVia: "browser" }));
    metrics.record(makeProposal({ wouldExecuteVia: "api" }));
    metrics.record(makeProposal({ wouldExecuteVia: "api" }));

    const summary = metrics.getSummary();
    expect(summary.byMethod["browser"]).toBe(1);
    expect(summary.byMethod["api"]).toBe(2);
  });

  it("aggregates multiple proposals correctly", () => {
    // 5 proposals across different dimensions
    metrics.record(makeProposal({ actionName: "A", tier: "GREEN", wouldExecuteVia: "browser", agentId: "agent-1" }));
    metrics.record(makeProposal({ actionName: "A", tier: "GREEN", wouldExecuteVia: "browser", agentId: "agent-1" }));
    metrics.record(makeProposal({ actionName: "B", tier: "YELLOW", wouldExecuteVia: "api", agentId: "agent-2" }));
    metrics.record(makeProposal({ actionName: "B", tier: "RED", wouldExecuteVia: "api", agentId: "agent-2" }));
    metrics.record(makeProposal({ actionName: "C", tier: "GREEN", wouldExecuteVia: "internal", agentId: "agent-1" }));

    const summary = metrics.getSummary();
    expect(summary.totalProposals).toBe(5);
    expect(summary.byAction["A"]).toBe(2);
    expect(summary.byAction["B"]).toBe(2);
    expect(summary.byAction["C"]).toBe(1);
    expect(summary.byTier["GREEN"]).toBe(3);
    expect(summary.byTier["YELLOW"]).toBe(1);
    expect(summary.byTier["RED"]).toBe(1);
    expect(summary.byMethod["browser"]).toBe(2);
    expect(summary.byMethod["api"]).toBe(2);
    expect(summary.byMethod["internal"]).toBe(1);
    expect(summary.byAgent["agent-1"]).toBe(3);
    expect(summary.byAgent["agent-2"]).toBe(2);
  });

  it("resets all counters", () => {
    metrics.record(makeProposal());
    metrics.record(makeProposal());
    metrics.recordReview({
      proposalId: "p-1",
      actionName: "Test",
      humanDecision: "agree",
    });

    metrics.reset();

    const summary = metrics.getSummary();
    expect(summary.totalProposals).toBe(0);
    expect(Object.keys(summary.byAction)).toHaveLength(0);
    expect(Object.keys(summary.byTier)).toHaveLength(0);
    expect(summary.byValidation.passed).toBe(0);
    expect(summary.byValidation.failed).toBe(0);
    expect(Object.keys(summary.byAgent)).toHaveLength(0);
    expect(Object.keys(summary.byMethod)).toHaveLength(0);

    const report = metrics.getAccuracyReport();
    expect(report.totalReviewed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Accuracy Report
// ---------------------------------------------------------------------------

describe("ShadowMetrics — Accuracy Report", () => {
  let metrics: ShadowMetrics;

  beforeEach(() => {
    metrics = new ShadowMetrics();
  });

  it("returns zero rates when no reviews exist", () => {
    const report = metrics.getAccuracyReport();
    expect(report.totalReviewed).toBe(0);
    expect(report.agreed).toBe(0);
    expect(report.disagreed).toBe(0);
    expect(report.agreeRate).toBe(0);
    expect(report.disagreeRate).toBe(0);
    expect(Object.keys(report.byAction)).toHaveLength(0);
  });

  it("computes agree/disagree rates correctly", () => {
    const reviews: ReviewedProposal[] = [
      { proposalId: "p-1", actionName: "AssignDriverToOrder", humanDecision: "agree" },
      { proposalId: "p-2", actionName: "AssignDriverToOrder", humanDecision: "agree" },
      { proposalId: "p-3", actionName: "AssignDriverToOrder", humanDecision: "disagree" },
      { proposalId: "p-4", actionName: "SendDriverMessage", humanDecision: "agree" },
      { proposalId: "p-5", actionName: "SendDriverMessage", humanDecision: "disagree" },
    ];

    for (const review of reviews) {
      metrics.recordReview(review);
    }

    const report = metrics.getAccuracyReport();
    expect(report.totalReviewed).toBe(5);
    expect(report.agreed).toBe(3);
    expect(report.disagreed).toBe(2);
    expect(report.agreeRate).toBeCloseTo(0.6, 5);
    expect(report.disagreeRate).toBeCloseTo(0.4, 5);
  });

  it("breaks down accuracy by action name", () => {
    metrics.recordReview({ proposalId: "p-1", actionName: "Assign", humanDecision: "agree" });
    metrics.recordReview({ proposalId: "p-2", actionName: "Assign", humanDecision: "agree" });
    metrics.recordReview({ proposalId: "p-3", actionName: "Assign", humanDecision: "disagree" });
    metrics.recordReview({ proposalId: "p-4", actionName: "Message", humanDecision: "disagree" });
    metrics.recordReview({ proposalId: "p-5", actionName: "Message", humanDecision: "disagree" });

    const report = metrics.getAccuracyReport();

    expect(report.byAction["Assign"]).toEqual({
      agreed: 2,
      disagreed: 1,
      agreeRate: 2 / 3,
    });
    expect(report.byAction["Message"]).toEqual({
      agreed: 0,
      disagreed: 2,
      agreeRate: 0,
    });
  });

  it("handles all-agree scenario", () => {
    metrics.recordReview({ proposalId: "p-1", actionName: "A", humanDecision: "agree" });
    metrics.recordReview({ proposalId: "p-2", actionName: "A", humanDecision: "agree" });

    const report = metrics.getAccuracyReport();
    expect(report.agreeRate).toBe(1);
    expect(report.disagreeRate).toBe(0);
  });

  it("handles all-disagree scenario", () => {
    metrics.recordReview({ proposalId: "p-1", actionName: "A", humanDecision: "disagree" });
    metrics.recordReview({ proposalId: "p-2", actionName: "A", humanDecision: "disagree" });

    const report = metrics.getAccuracyReport();
    expect(report.agreeRate).toBe(0);
    expect(report.disagreeRate).toBe(1);
  });
});
