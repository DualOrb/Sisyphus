/**
 * Minimal in-memory Redis mock for unit tests.
 *
 * Implements only the subset of ioredis methods used by the memory layer:
 * get, set (with EX/NX), del, expire, ttl, zadd, zrangebyscore, zremrangebyscore, zcard, eval.
 */

interface StoredEntry {
  value: string;
  expiresAt?: number; // Date.now() ms
}

interface SortedSetMember {
  score: number;
  member: string;
}

export function createMockRedis() {
  const store = new Map<string, StoredEntry>();
  const sortedSets = new Map<string, SortedSetMember[]>();
  const ttls = new Map<string, number>(); // key -> expiresAt ms

  function isExpired(key: string): boolean {
    const entry = store.get(key);
    if (entry?.expiresAt && Date.now() >= entry.expiresAt) {
      store.delete(key);
      ttls.delete(key);
      return true;
    }
    return false;
  }

  const mock = {
    // ---- String commands ----

    async get(key: string): Promise<string | null> {
      isExpired(key);
      const entry = store.get(key);
      return entry ? entry.value : null;
    },

    async set(key: string, value: string, ...args: any[]): Promise<string | null> {
      let exSeconds: number | undefined;
      let nx = false;

      // Parse variadic args: "EX" <seconds> "NX"
      for (let i = 0; i < args.length; i++) {
        const arg = typeof args[i] === "string" ? args[i].toUpperCase() : args[i];
        if (arg === "EX" && i + 1 < args.length) {
          exSeconds = args[++i];
        } else if (arg === "NX") {
          nx = true;
        }
      }

      if (nx) {
        isExpired(key);
        if (store.has(key)) {
          return null;
        }
      }

      const entry: StoredEntry = { value };
      if (exSeconds != null) {
        entry.expiresAt = Date.now() + exSeconds * 1000;
        ttls.set(key, entry.expiresAt);
      }

      store.set(key, entry);
      return "OK";
    },

    async del(key: string): Promise<number> {
      const existed = store.has(key) || sortedSets.has(key);
      store.delete(key);
      sortedSets.delete(key);
      ttls.delete(key);
      return existed ? 1 : 0;
    },

    async expire(key: string, seconds: number): Promise<number> {
      if (!store.has(key) && !sortedSets.has(key)) return 0;
      const expiresAt = Date.now() + seconds * 1000;
      ttls.set(key, expiresAt);
      // Also update store entry if present
      const entry = store.get(key);
      if (entry) {
        entry.expiresAt = expiresAt;
      }
      return 1;
    },

    async ttl(key: string): Promise<number> {
      isExpired(key);
      const expiresAt = ttls.get(key);
      if (expiresAt == null) {
        return store.has(key) || sortedSets.has(key) ? -1 : -2;
      }
      const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
      return remaining > 0 ? remaining : -2;
    },

    // ---- Sorted set commands ----

    async zadd(key: string, score: number, member: string): Promise<number> {
      if (!sortedSets.has(key)) {
        sortedSets.set(key, []);
      }
      const set = sortedSets.get(key)!;
      // Remove existing member with same value, then add
      const idx = set.findIndex((m) => m.member === member);
      if (idx !== -1) {
        set[idx].score = score;
        return 0; // updated, not added
      }
      set.push({ score, member });
      set.sort((a, b) => a.score - b.score);
      return 1;
    },

    async zrangebyscore(
      key: string,
      min: number | string,
      max: number | string,
      ...args: any[]
    ): Promise<string[]> {
      const set = sortedSets.get(key) ?? [];
      const minScore = min === "-inf" ? -Infinity : Number(min);
      const maxScore = max === "+inf" ? Infinity : Number(max);
      const matching = set.filter((m) => m.score >= minScore && m.score <= maxScore);

      const withScores = args.some(
        (a) => typeof a === "string" && a.toUpperCase() === "WITHSCORES",
      );

      if (withScores) {
        const result: string[] = [];
        for (const m of matching) {
          result.push(m.member);
          result.push(String(m.score));
        }
        return result;
      }

      return matching.map((m) => m.member);
    },

    async zremrangebyscore(
      key: string,
      min: number | string,
      max: number | string,
    ): Promise<number> {
      const set = sortedSets.get(key);
      if (!set) return 0;
      const minScore = min === "-inf" ? -Infinity : Number(min);
      const maxScore = max === "+inf" ? Infinity : Number(max);
      const before = set.length;
      const remaining = set.filter((m) => m.score < minScore || m.score > maxScore);
      sortedSets.set(key, remaining);
      return before - remaining.length;
    },

    async zcard(key: string): Promise<number> {
      return (sortedSets.get(key) ?? []).length;
    },

    // ---- Lua eval (minimal implementation for lock scripts) ----

    async eval(script: string, numKeys: number, ...args: any[]): Promise<unknown> {
      const keys = args.slice(0, numKeys) as string[];
      const argv = args.slice(numKeys) as string[];

      // Detect the releaseLock Lua script pattern: GET -> check agentId -> DEL
      if (script.includes("cjson.decode") && script.includes("agentId")) {
        const key = keys[0];
        const requestedAgentId = argv[0];

        isExpired(key);
        const entry = store.get(key);
        if (!entry) return 0;

        try {
          const payload = JSON.parse(entry.value);
          if (payload.agentId === requestedAgentId) {
            store.delete(key);
            ttls.delete(key);
            return 1;
          }
        } catch {
          // invalid JSON
        }
        return 0;
      }

      return null;
    },
  };

  return mock;
}

export type MockRedis = ReturnType<typeof createMockRedis>;
