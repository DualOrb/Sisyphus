/**
 * Unit tests for the Sisyphus guardrails engine.
 *
 * Covers: Registry, Validator, Cooldown, Rate Limiter, Circuit Breaker.
 * Redis is mocked with a minimal in-memory implementation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";

import {
  defineAction,
  getAction,
  listActions,
  clearActions,
} from "@guardrails/registry";
import { validateSubmissionCriteria } from "@guardrails/validator";
import { checkCooldown, setCooldown } from "@guardrails/cooldown";
import { checkRateLimit } from "@guardrails/rate-limiter";
import {
  recordFailure,
  recordSuccess,
  isCircuitOpen,
} from "@guardrails/circuit-breaker";

import type { ActionDefinition, RateLimitConfig } from "@guardrails/types";
import { Tier } from "@guardrails/types";

// ---------------------------------------------------------------------------
// Helpers — minimal Redis mock
// ---------------------------------------------------------------------------

/**
 * Creates a lightweight in-memory Redis mock that satisfies the subset of the
 * ioredis API used by the guardrails modules: get, set, ttl, del, zadd,
 * zremrangebyscore, zcard, zrange, zcount, expire.
 */
function createRedisMock() {
  const store = new Map<string, string>();
  const sortedSets = new Map<string, { score: number; member: string }[]>();
  const ttls = new Map<string, number>(); // absolute expiry timestamp (seconds)

  const mock = {
    // -- String commands --

    get: vi.fn(async (key: string): Promise<string | null> => {
      // Check TTL expiry
      const exp = ttls.get(key);
      if (exp !== undefined && Date.now() / 1000 > exp) {
        store.delete(key);
        ttls.delete(key);
        return null;
      }
      return store.get(key) ?? null;
    }),

    set: vi.fn(async (key: string, value: string, ...args: unknown[]): Promise<"OK"> => {
      store.set(key, value);
      // Handle "EX" ttl argument: set(key, value, "EX", seconds)
      if (args[0] === "EX" && typeof args[1] === "number") {
        ttls.set(key, Date.now() / 1000 + args[1]);
      }
      return "OK";
    }),

    ttl: vi.fn(async (key: string): Promise<number> => {
      const exp = ttls.get(key);
      if (exp === undefined) return -1;
      const remaining = Math.ceil(exp - Date.now() / 1000);
      return remaining > 0 ? remaining : -2;
    }),

    del: vi.fn(async (key: string): Promise<number> => {
      const existed =
        store.delete(key) || sortedSets.delete(key) ? 1 : 0;
      ttls.delete(key);
      return existed;
    }),

    // -- Sorted set commands --

    zadd: vi.fn(async (key: string, score: number, member: string): Promise<number> => {
      if (!sortedSets.has(key)) sortedSets.set(key, []);
      const set = sortedSets.get(key)!;
      set.push({ score, member });
      set.sort((a, b) => a.score - b.score);
      return 1;
    }),

    zremrangebyscore: vi.fn(
      async (key: string, min: number | string, max: number | string): Promise<number> => {
        const set = sortedSets.get(key);
        if (!set) return 0;
        const minVal = min === "-inf" ? -Infinity : Number(min);
        const maxVal = max === "+inf" ? Infinity : Number(max);
        const before = set.length;
        const filtered = set.filter((e) => e.score < minVal || e.score > maxVal);
        sortedSets.set(key, filtered);
        return before - filtered.length;
      },
    ),

    zcard: vi.fn(async (key: string): Promise<number> => {
      return sortedSets.get(key)?.length ?? 0;
    }),

    zrange: vi.fn(
      async (key: string, start: number, stop: number, ...args: unknown[]): Promise<string[]> => {
        const set = sortedSets.get(key);
        if (!set || set.length === 0) return [];
        const sliceEnd = stop < 0 ? set.length + stop + 1 : stop + 1;
        const slice = set.slice(start, sliceEnd);
        const withScores = args.includes("WITHSCORES");
        if (withScores) {
          const result: string[] = [];
          for (const entry of slice) {
            result.push(entry.member, String(entry.score));
          }
          return result;
        }
        return slice.map((e) => e.member);
      },
    ),

    zcount: vi.fn(
      async (key: string, min: number | string, max: number | string): Promise<number> => {
        const set = sortedSets.get(key);
        if (!set) return 0;
        const minVal = min === "-inf" ? -Infinity : Number(min);
        const maxVal = max === "+inf" ? Infinity : Number(max);
        return set.filter((e) => e.score >= minVal && e.score <= maxVal).length;
      },
    ),

    expire: vi.fn(async (key: string, seconds: number): Promise<number> => {
      ttls.set(key, Date.now() / 1000 + seconds);
      return 1;
    }),

    // -- Expose internals for test assertions --
    _store: store,
    _sortedSets: sortedSets,
    _ttls: ttls,
  };

  return mock;
}

type RedisMock = ReturnType<typeof createRedisMock>;

// ---------------------------------------------------------------------------
// Helpers — action fixture factory
// ---------------------------------------------------------------------------

function makeAction(
  overrides: Partial<ActionDefinition<Record<string, unknown>>> = {},
): ActionDefinition<Record<string, unknown>> {
  return {
    name: overrides.name ?? "TestAction",
    description: overrides.description ?? "A test action",
    tier: overrides.tier ?? Tier.GREEN,
    paramsSchema: overrides.paramsSchema ?? z.object({}),
    criteria: overrides.criteria ?? [],
    execution: overrides.execution ?? "api",
    ...overrides,
  };
}

// ===========================================================================
// 1. Registry
// ===========================================================================

describe("Registry", () => {
  beforeEach(() => {
    clearActions();
  });

  it("defineAction registers an action that can be retrieved with getAction", () => {
    const action = makeAction({ name: "AssignDriver" });
    defineAction(action);

    const retrieved = getAction("AssignDriver");
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe("AssignDriver");
    expect(retrieved!.tier).toBe(Tier.GREEN);
  });

  it("getAction returns undefined for an unregistered name", () => {
    expect(getAction("NonExistent")).toBeUndefined();
  });

  it("throws when registering a duplicate action name", () => {
    defineAction(makeAction({ name: "Dup" }));
    expect(() => defineAction(makeAction({ name: "Dup" }))).toThrowError(
      /already registered/,
    );
  });

  it("listActions returns all registered actions", () => {
    defineAction(makeAction({ name: "A" }));
    defineAction(makeAction({ name: "B" }));
    defineAction(makeAction({ name: "C" }));

    const all = listActions();
    expect(all).toHaveLength(3);
    const names = all.map((a) => a.name);
    expect(names).toContain("A");
    expect(names).toContain("B");
    expect(names).toContain("C");
  });

  it("listActions returns an empty array when no actions are registered", () => {
    expect(listActions()).toEqual([]);
  });

  it("clearActions removes all registered actions", () => {
    defineAction(makeAction({ name: "X" }));
    defineAction(makeAction({ name: "Y" }));
    expect(listActions()).toHaveLength(2);

    clearActions();
    expect(listActions()).toHaveLength(0);
    expect(getAction("X")).toBeUndefined();
  });
});

// ===========================================================================
// 2. Validator
// ===========================================================================

describe("Validator", () => {
  it("returns passed: true when all criteria pass", () => {
    const action = makeAction({
      criteria: [
        {
          name: "always-pass",
          check: () => ({ passed: true }),
        },
      ],
    });

    const result = validateSubmissionCriteria(action, {}, {});
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns passed: true when there are no criteria", () => {
    const action = makeAction({ criteria: [] });

    const result = validateSubmissionCriteria(action, {}, {});
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns passed: false with errors when a criterion fails", () => {
    const action = makeAction({
      criteria: [
        {
          name: "must-have-orderId",
          check: (params) => ({
            passed: !!params.orderId,
            message: "orderId is required",
          }),
        },
      ],
    });

    const result = validateSubmissionCriteria(action, {}, {});
    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].rule).toBe("must-have-orderId");
    expect(result.errors[0].message).toBe("orderId is required");
  });

  it("returns a default message when a failing criterion provides no message", () => {
    const action = makeAction({
      criteria: [
        {
          name: "no-message-criterion",
          check: () => ({ passed: false }),
        },
      ],
    });

    const result = validateSubmissionCriteria(action, {}, {});
    expect(result.passed).toBe(false);
    expect(result.errors[0].message).toContain("no-message-criterion");
  });

  it("evaluates all criteria even when early ones fail (no short-circuit)", () => {
    const action = makeAction({
      criteria: [
        {
          name: "first-fail",
          check: () => ({ passed: false, message: "first failed" }),
        },
        {
          name: "second-pass",
          check: () => ({ passed: true }),
        },
        {
          name: "third-fail",
          check: () => ({ passed: false, message: "third failed" }),
        },
      ],
    });

    const result = validateSubmissionCriteria(action, {}, {});
    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].rule).toBe("first-fail");
    expect(result.errors[1].rule).toBe("third-fail");
  });

  it("treats a criterion that throws as a failure (fail-closed)", () => {
    const action = makeAction({
      criteria: [
        {
          name: "throws-an-error",
          check: () => {
            throw new Error("unexpected explosion");
          },
        },
      ],
    });

    const result = validateSubmissionCriteria(action, {}, {});
    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].rule).toBe("throws-an-error");
    expect(result.errors[0].message).toContain("unexpected explosion");
    expect(result.errors[0].context).toEqual({ error: "unexpected explosion" });
  });

  it("handles a criterion that throws a non-Error value", () => {
    const action = makeAction({
      criteria: [
        {
          name: "throws-string",
          check: () => {
            throw "raw string throw"; // eslint-disable-line no-throw-literal
          },
        },
      ],
    });

    const result = validateSubmissionCriteria(action, {}, {});
    expect(result.passed).toBe(false);
    expect(result.errors[0].message).toContain("raw string throw");
  });

  it("passes params and state through to the criterion check function", () => {
    const checkSpy = vi.fn(() => ({ passed: true }));
    const action = makeAction({
      criteria: [{ name: "spy", check: checkSpy }],
    });

    const params = { orderId: "123" };
    const state = { driverAvailable: true };
    validateSubmissionCriteria(action, params, state);

    expect(checkSpy).toHaveBeenCalledWith(params, state);
  });
});

// ===========================================================================
// 3. Cooldown
// ===========================================================================

describe("Cooldown", () => {
  let redis: RedisMock;

  beforeEach(() => {
    redis = createRedisMock();
  });

  it("checkCooldown returns allowed: true when no key exists", async () => {
    const result = await checkCooldown(
      redis as any,
      "order",
      "order-42",
      "assign",
    );
    expect(result.allowed).toBe(true);
    expect(result.secondsRemaining).toBeUndefined();
    expect(result.lastActionBy).toBeUndefined();
  });

  it("checkCooldown returns allowed: false with TTL when key exists", async () => {
    // Pre-populate the key as setCooldown would
    await setCooldown(
      redis as any,
      "order",
      "order-42",
      "assign",
      "agent-1",
      300,
    );

    const result = await checkCooldown(
      redis as any,
      "order",
      "order-42",
      "assign",
    );
    expect(result.allowed).toBe(false);
    expect(result.secondsRemaining).toBeGreaterThan(0);
    expect(result.lastActionBy).toBe("agent-1");
  });

  it("setCooldown stores a JSON record with EX TTL", async () => {
    await setCooldown(
      redis as any,
      "driver",
      "d-7",
      "message",
      "agent-2",
      60,
      { reason: "follow-up" },
    );

    const key = "cooldown:driver:d-7:message";
    expect(redis.set).toHaveBeenCalledWith(
      key,
      expect.any(String),
      "EX",
      60,
    );

    const raw = await redis.get(key);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.agentId).toBe("agent-2");
    expect(parsed.context).toEqual({ reason: "follow-up" });
    expect(parsed.timestamp).toBeTypeOf("number");
  });

  it("setCooldown with no context stores null context", async () => {
    await setCooldown(
      redis as any,
      "order",
      "o-1",
      "cancel",
      "agent-3",
      120,
    );

    const raw = await redis.get("cooldown:order:o-1:cancel");
    const parsed = JSON.parse(raw!);
    expect(parsed.context).toBeNull();
  });
});

// ===========================================================================
// 4. Rate Limiter
// ===========================================================================

describe("Rate Limiter", () => {
  let redis: RedisMock;

  const config: RateLimitConfig = {
    maxPerHour: 5,
    scope: "per_entity",
  };

  beforeEach(() => {
    redis = createRedisMock();
  });

  it("allows requests when under the limit", async () => {
    const result = await checkRateLimit(
      redis as any,
      "agent-1",
      "AssignDriver",
      config,
    );

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4); // 5 max - 0 existing - 1 just recorded
    expect(result.resetIn).toBe(3600);
  });

  it("tracks invocations and decrements remaining count", async () => {
    // First three calls should succeed
    for (let i = 0; i < 3; i++) {
      const result = await checkRateLimit(
        redis as any,
        "agent-1",
        "AssignDriver",
        config,
      );
      expect(result.allowed).toBe(true);
    }

    const result = await checkRateLimit(
      redis as any,
      "agent-1",
      "AssignDriver",
      config,
    );
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1); // 5 - 4 existing - 1 just recorded = 0 ... wait
    // After 4 calls: 4 recorded. On the 4th call, count before zadd is 3, so remaining = 5-3-1 = 1
    // Actually let's just confirm it's allowed with remaining >= 0
    expect(result.remaining).toBeGreaterThanOrEqual(0);
  });

  it("blocks requests when at the limit", async () => {
    // Fill up to the limit
    for (let i = 0; i < config.maxPerHour; i++) {
      const r = await checkRateLimit(
        redis as any,
        "agent-1",
        "AssignDriver",
        config,
      );
      expect(r.allowed).toBe(true);
    }

    // Next request should be blocked
    const blocked = await checkRateLimit(
      redis as any,
      "agent-1",
      "AssignDriver",
      config,
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetIn).toBeGreaterThanOrEqual(0);
  });

  it("sliding window expires old entries", async () => {
    // Manually insert entries that are older than the 1-hour window
    const key = "ratelimit:agent-1:AssignDriver";
    const pastTime = Date.now() / 1000 - 4000; // ~67 minutes ago
    for (let i = 0; i < config.maxPerHour; i++) {
      await redis.zadd(key, pastTime + i, `old-${i}`);
    }

    // Verify they were inserted
    const countBefore = await redis.zcard(key);
    expect(countBefore).toBe(config.maxPerHour);

    // checkRateLimit should prune expired entries and allow the request
    const result = await checkRateLimit(
      redis as any,
      "agent-1",
      "AssignDriver",
      config,
    );
    expect(result.allowed).toBe(true);
  });

  it("uses separate keys per agent", async () => {
    await checkRateLimit(redis as any, "agent-A", "X", config);
    await checkRateLimit(redis as any, "agent-B", "X", config);

    // Each agent should have exactly 1 entry
    const countA = await redis.zcard("ratelimit:agent-A:X");
    const countB = await redis.zcard("ratelimit:agent-B:X");
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });
});

// ===========================================================================
// 5. Circuit Breaker
// ===========================================================================

describe("Circuit Breaker", () => {
  let redis: RedisMock;
  const agentId = "agent-42";

  beforeEach(() => {
    redis = createRedisMock();
  });

  it("starts closed (no failures)", async () => {
    const result = await isCircuitOpen(redis as any, agentId);
    expect(result.open).toBe(false);
    expect(result.failureCount).toBe(0);
    expect(result.message).toBeUndefined();
  });

  it("stays closed when failures are below the threshold", async () => {
    // Record 2 failures (short-window threshold is 3)
    await recordFailure(redis as any, agentId);
    await recordFailure(redis as any, agentId);

    const result = await isCircuitOpen(redis as any, agentId);
    expect(result.open).toBe(false);
    expect(result.failureCount).toBe(2);
  });

  it("opens after exceeding the short-window threshold (>3 in 5 min)", async () => {
    // Record 4 failures — exceeds the short-window threshold of 3
    for (let i = 0; i < 4; i++) {
      await recordFailure(redis as any, agentId);
    }

    const result = await isCircuitOpen(redis as any, agentId);
    expect(result.open).toBe(true);
    expect(result.failureCount).toBeGreaterThan(3);
    expect(result.message).toContain("5 minutes");
  });

  it("opens after exceeding the long-window threshold (>5 in 15 min)", async () => {
    // Record 6 failures — exceeds the long-window threshold of 5
    for (let i = 0; i < 6; i++) {
      await recordFailure(redis as any, agentId);
    }

    const result = await isCircuitOpen(redis as any, agentId);
    expect(result.open).toBe(true);
    expect(result.failureCount).toBeGreaterThan(5);
    expect(result.message).toContain("15 minutes");
  });

  it("resets (closes) after a successful execution", async () => {
    // Build up failures past the threshold
    for (let i = 0; i < 4; i++) {
      await recordFailure(redis as any, agentId);
    }
    const beforeReset = await isCircuitOpen(redis as any, agentId);
    expect(beforeReset.open).toBe(true);

    // Record success — should clear the sorted set
    await recordSuccess(redis as any, agentId);

    const afterReset = await isCircuitOpen(redis as any, agentId);
    expect(afterReset.open).toBe(false);
    expect(afterReset.failureCount).toBe(0);
  });

  it("recordFailure calls zadd and expire on the correct key", async () => {
    await recordFailure(redis as any, agentId);

    expect(redis.zadd).toHaveBeenCalledWith(
      `circuitbreaker:${agentId}`,
      expect.any(Number),
      expect.any(String),
    );
    expect(redis.expire).toHaveBeenCalledWith(
      `circuitbreaker:${agentId}`,
      960, // LONG_WINDOW_SECONDS (900) + 60
    );
  });

  it("recordSuccess deletes the circuit breaker key", async () => {
    await recordFailure(redis as any, agentId);
    await recordSuccess(redis as any, agentId);

    expect(redis.del).toHaveBeenCalledWith(`circuitbreaker:${agentId}`);
  });

  it("is scoped per agent — one agent's failures do not affect another", async () => {
    for (let i = 0; i < 4; i++) {
      await recordFailure(redis as any, "agent-bad");
    }

    const badResult = await isCircuitOpen(redis as any, "agent-bad");
    const goodResult = await isCircuitOpen(redis as any, "agent-good");

    expect(badResult.open).toBe(true);
    expect(goodResult.open).toBe(false);
  });
});
