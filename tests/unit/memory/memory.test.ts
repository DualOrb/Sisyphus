/**
 * Unit tests for the Sisyphus memory layer (Redis-backed):
 * - Action Timeline (sorted-set based action history)
 * - Locks (exclusive entity locking with owner verification)
 * - Heartbeat (agent liveness detection)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createMockRedis, type MockRedis } from "../../helpers/mock-redis";
import { recordAction, getRecentActions } from "@memory/redis/action-timeline";
import { acquireLock, releaseLock, getLockHolder } from "@memory/redis/locks";
import { sendHeartbeat, checkHeartbeat } from "@memory/redis/heartbeat";

// ===========================================================================
// ACTION TIMELINE
// ===========================================================================

describe("Action Timeline", () => {
  let redis: MockRedis;

  beforeEach(() => {
    redis = createMockRedis();
  });

  describe("recordAction", () => {
    it("adds an action to the entity's sorted set", async () => {
      await recordAction(redis as any, "order", "order-123", {
        action: "assign_driver",
        agent: "dispatch-agent",
        taskId: "task-1",
      });

      const count = await redis.zcard("actions:order:order-123");
      expect(count).toBe(1);
    });

    it("records multiple actions for the same entity", async () => {
      await recordAction(redis as any, "order", "order-123", {
        action: "assign_driver",
        agent: "dispatch-agent",
      });
      await recordAction(redis as any, "order", "order-123", {
        action: "send_notification",
        agent: "notify-agent",
      });

      const count = await redis.zcard("actions:order:order-123");
      expect(count).toBe(2);
    });

    it("records actions for different entities independently", async () => {
      await recordAction(redis as any, "order", "order-1", {
        action: "assign_driver",
      });
      await recordAction(redis as any, "order", "order-2", {
        action: "cancel_order",
      });

      expect(await redis.zcard("actions:order:order-1")).toBe(1);
      expect(await redis.zcard("actions:order:order-2")).toBe(1);
    });

    it("stores action data as JSON with a timestamp field", async () => {
      await recordAction(redis as any, "order", "order-123", {
        action: "assign_driver",
        agent: "dispatch-agent",
        contentPreview: "Assigned driver@test.com",
      });

      const raw = await redis.zrangebyscore("actions:order:order-123", 0, "+inf");
      expect(raw).toHaveLength(1);

      const parsed = JSON.parse(raw[0]);
      expect(parsed.action).toBe("assign_driver");
      expect(parsed.agent).toBe("dispatch-agent");
      expect(parsed.contentPreview).toBe("Assigned driver@test.com");
      expect(typeof parsed.ts).toBe("number");
    });
  });

  describe("getRecentActions", () => {
    it("returns actions within the time window", async () => {
      await recordAction(redis as any, "order", "order-123", {
        action: "first_action",
      });
      await recordAction(redis as any, "order", "order-123", {
        action: "second_action",
      });

      const recent = await getRecentActions(redis as any, "order", "order-123", 30);
      expect(recent).toHaveLength(2);
      expect(recent[0].action.action).toBe("first_action");
      expect(recent[1].action.action).toBe("second_action");
    });

    it("returns ScoredAction objects with action and timestamp fields", async () => {
      await recordAction(redis as any, "order", "order-123", {
        action: "test_action",
        agent: "test-agent",
      });

      const recent = await getRecentActions(redis as any, "order", "order-123");
      expect(recent).toHaveLength(1);
      expect(recent[0].action).toBeDefined();
      expect(recent[0].action.action).toBe("test_action");
      expect(recent[0].action.agent).toBe("test-agent");
      expect(typeof recent[0].timestamp).toBe("number");
    });

    it("returns empty array when no actions exist", async () => {
      const recent = await getRecentActions(redis as any, "order", "nonexistent");
      expect(recent).toEqual([]);
    });

    it("filters out old actions beyond the time window", async () => {
      // Manually insert an old action with a score from 2 hours ago
      const oldScore = Date.now() / 1000 - 7200; // 2 hours ago
      const oldAction = JSON.stringify({ action: "old_action", ts: oldScore });
      await redis.zadd("actions:order:order-123", oldScore, oldAction);

      // Insert a recent action normally
      await recordAction(redis as any, "order", "order-123", {
        action: "recent_action",
      });

      // Default window is 30 minutes — only the recent one should appear
      const recent = await getRecentActions(redis as any, "order", "order-123", 30);
      expect(recent).toHaveLength(1);
      expect(recent[0].action.action).toBe("recent_action");
    });

    it("respects custom time window parameter", async () => {
      // Insert action scored 10 minutes ago
      const tenMinAgo = Date.now() / 1000 - 600;
      const action = JSON.stringify({ action: "ten_min_old", ts: tenMinAgo });
      await redis.zadd("actions:order:order-123", tenMinAgo, action);

      // 5-minute window should exclude it
      const narrow = await getRecentActions(redis as any, "order", "order-123", 5);
      expect(narrow).toHaveLength(0);

      // 15-minute window should include it
      const wide = await getRecentActions(redis as any, "order", "order-123", 15);
      expect(wide).toHaveLength(1);
    });
  });
});

// ===========================================================================
// LOCKS
// ===========================================================================

describe("Locks", () => {
  let redis: MockRedis;

  beforeEach(() => {
    redis = createMockRedis();
  });

  describe("acquireLock", () => {
    it("succeeds on first attempt (no existing lock)", async () => {
      const result = await acquireLock(
        redis as any,
        "order",
        "order-123",
        "agent-alpha",
      );

      expect(result.acquired).toBe(true);
    });

    it("fails when another agent already holds the lock", async () => {
      // Agent alpha acquires the lock
      const first = await acquireLock(
        redis as any,
        "order",
        "order-123",
        "agent-alpha",
      );
      expect(first.acquired).toBe(true);

      // Agent beta tries to acquire the same lock
      const second = await acquireLock(
        redis as any,
        "order",
        "order-123",
        "agent-beta",
      );
      expect(second.acquired).toBe(false);
      expect(second.holder).toBeDefined();
      expect(second.holder!.agentId).toBe("agent-alpha");
    });

    it("stores the agentId in the lock payload", async () => {
      await acquireLock(redis as any, "order", "order-123", "agent-alpha", 600, "task-42");

      const holder = await getLockHolder(redis as any, "order", "order-123");
      expect(holder).not.toBeNull();
      expect(holder!.agentId).toBe("agent-alpha");
      expect(holder!.taskId).toBe("task-42");
      expect(typeof holder!.since).toBe("number");
    });

    it("acquires lock with a TTL", async () => {
      await acquireLock(redis as any, "order", "order-123", "agent-alpha", 300);

      const ttl = await redis.ttl("lock:order:order-123");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(300);
    });

    it("allows different entities to be locked independently", async () => {
      const lock1 = await acquireLock(redis as any, "order", "order-1", "agent-alpha");
      const lock2 = await acquireLock(redis as any, "order", "order-2", "agent-beta");

      expect(lock1.acquired).toBe(true);
      expect(lock2.acquired).toBe(true);
    });

    it("allows different entity types to be locked independently", async () => {
      const lockOrder = await acquireLock(redis as any, "order", "123", "agent-alpha");
      const lockDriver = await acquireLock(redis as any, "driver", "123", "agent-beta");

      expect(lockOrder.acquired).toBe(true);
      expect(lockDriver.acquired).toBe(true);
    });
  });

  describe("releaseLock", () => {
    it("releases a lock when called by the owner", async () => {
      await acquireLock(redis as any, "order", "order-123", "agent-alpha");

      const released = await releaseLock(redis as any, "order", "order-123", "agent-alpha");
      expect(released).toBe(true);

      // Lock should now be gone
      const holder = await getLockHolder(redis as any, "order", "order-123");
      expect(holder).toBeNull();
    });

    it("does NOT release a lock when called by a non-owner", async () => {
      await acquireLock(redis as any, "order", "order-123", "agent-alpha");

      const released = await releaseLock(redis as any, "order", "order-123", "agent-beta");
      expect(released).toBe(false);

      // Lock should still be held by alpha
      const holder = await getLockHolder(redis as any, "order", "order-123");
      expect(holder).not.toBeNull();
      expect(holder!.agentId).toBe("agent-alpha");
    });

    it("returns false when no lock exists", async () => {
      const released = await releaseLock(redis as any, "order", "nonexistent", "agent-alpha");
      expect(released).toBe(false);
    });

    it("allows re-acquisition after release", async () => {
      await acquireLock(redis as any, "order", "order-123", "agent-alpha");
      await releaseLock(redis as any, "order", "order-123", "agent-alpha");

      const result = await acquireLock(redis as any, "order", "order-123", "agent-beta");
      expect(result.acquired).toBe(true);

      const holder = await getLockHolder(redis as any, "order", "order-123");
      expect(holder!.agentId).toBe("agent-beta");
    });
  });

  describe("getLockHolder", () => {
    it("returns null when no lock is held", async () => {
      const holder = await getLockHolder(redis as any, "order", "order-123");
      expect(holder).toBeNull();
    });

    it("returns the correct LockPayload when lock is held", async () => {
      await acquireLock(redis as any, "order", "order-123", "agent-alpha", 600, "task-99");

      const holder = await getLockHolder(redis as any, "order", "order-123");
      expect(holder).not.toBeNull();
      expect(holder!.agentId).toBe("agent-alpha");
      expect(holder!.taskId).toBe("task-99");
      expect(typeof holder!.since).toBe("number");
      // 'since' should be close to now (within 5 seconds)
      const nowSeconds = Date.now() / 1000;
      expect(holder!.since).toBeGreaterThan(nowSeconds - 5);
      expect(holder!.since).toBeLessThanOrEqual(nowSeconds + 1);
    });
  });
});

// ===========================================================================
// HEARTBEAT
// ===========================================================================

describe("Heartbeat", () => {
  let redis: MockRedis;

  beforeEach(() => {
    redis = createMockRedis();
  });

  describe("sendHeartbeat", () => {
    it("stores a value in Redis for the agent", async () => {
      await sendHeartbeat(redis as any, "agent-alpha");

      const raw = await redis.get("heartbeat:agent-alpha");
      expect(raw).not.toBeNull();

      // Value should be a Unix epoch seconds number
      const ts = parseFloat(raw!);
      expect(ts).toBeGreaterThan(0);
      const nowSeconds = Date.now() / 1000;
      expect(ts).toBeGreaterThan(nowSeconds - 5);
    });

    it("sets a TTL on the heartbeat key", async () => {
      await sendHeartbeat(redis as any, "agent-alpha");

      const ttl = await redis.ttl("heartbeat:agent-alpha");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(120);
    });

    it("overwrites the previous heartbeat on subsequent calls", async () => {
      await sendHeartbeat(redis as any, "agent-alpha");
      const first = await redis.get("heartbeat:agent-alpha");

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));

      await sendHeartbeat(redis as any, "agent-alpha");
      const second = await redis.get("heartbeat:agent-alpha");

      // Both should be valid numbers; second should be >= first
      expect(parseFloat(second!)).toBeGreaterThanOrEqual(parseFloat(first!));
    });
  });

  describe("checkHeartbeat", () => {
    it("returns alive: true immediately after sendHeartbeat", async () => {
      await sendHeartbeat(redis as any, "agent-alpha");

      const status = await checkHeartbeat(redis as any, "agent-alpha");
      expect(status.alive).toBe(true);
      expect(status.lastSeenSecondsAgo).toBeDefined();
      expect(status.lastSeenSecondsAgo!).toBeLessThan(5);
    });

    it("returns alive: false for an unknown agent", async () => {
      const status = await checkHeartbeat(redis as any, "agent-unknown");
      expect(status.alive).toBe(false);
      expect(status.lastSeenSecondsAgo).toBeUndefined();
    });

    it("returns alive: false after the key expires (simulated)", async () => {
      // Directly set a heartbeat key with already-expired timestamp
      // In reality TTL handles this, but we simulate by deleting the key
      await sendHeartbeat(redis as any, "agent-alpha");
      await redis.del("heartbeat:agent-alpha");

      const status = await checkHeartbeat(redis as any, "agent-alpha");
      expect(status.alive).toBe(false);
    });

    it("reports lastSeenSecondsAgo as a non-negative integer", async () => {
      await sendHeartbeat(redis as any, "agent-alpha");

      const status = await checkHeartbeat(redis as any, "agent-alpha");
      expect(status.alive).toBe(true);
      expect(status.lastSeenSecondsAgo).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(status.lastSeenSecondsAgo)).toBe(true);
    });

    it("tracks multiple agents independently", async () => {
      await sendHeartbeat(redis as any, "agent-alpha");
      await sendHeartbeat(redis as any, "agent-beta");

      // Delete only alpha
      await redis.del("heartbeat:agent-alpha");

      const alpha = await checkHeartbeat(redis as any, "agent-alpha");
      const beta = await checkHeartbeat(redis as any, "agent-beta");

      expect(alpha.alive).toBe(false);
      expect(beta.alive).toBe(true);
    });
  });
});
