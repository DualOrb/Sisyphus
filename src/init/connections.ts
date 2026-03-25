/**
 * Connection initialization for Sisyphus.
 *
 * Creates and validates all external connections: Redis, PostgreSQL, dispatch
 * adapter, Chrome browser, and WebSocket client. Each step is logged and has
 * error handling. If a critical step fails, already-created connections are
 * cleaned up before the error is thrown.
 */

import type { Browser, Page } from "playwright";
import type { Redis } from "ioredis";
import type { PostgresDb } from "../memory/postgres/client.js";
import type { DispatchAdapter } from "../adapters/types.js";
import type { DispatchWebSocket } from "../execution/websocket/client.js";
import type { Env } from "../config/env.js";

import { createRedisClient } from "../memory/redis/client.js";
import { createPostgresClient } from "../memory/postgres/client.js";
import { createDispatchAdapterFromEnv } from "../adapters/factory.js";
import { connectBrowser, createDispatchPage } from "../execution/browser/connection.js";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("init:connections");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SisyphusConnections {
  redis: Redis;
  db: PostgresDb;
  adapter: DispatchAdapter;
  sessionCookie: string;
  browser: Browser | null;
  page: Page | null;
  wsClient: DispatchWebSocket | null;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize all external connections required by Sisyphus.
 *
 * Steps:
 *  1. Create and verify Redis client
 *  2. Create and verify PostgreSQL client
 *  3. Create dispatch adapter (old or new based on env)
 *  4. Connect to Chrome via Playwright CDP (non-fatal if unavailable)
 *  5. Login to dispatch via browser (non-fatal)
 *  6. Extract session cookie (non-fatal)
 *
 * @throws If Redis or PostgreSQL connections fail (these are critical).
 */
export async function initializeConnections(envVars: Env): Promise<SisyphusConnections> {
  log.info("Initializing Sisyphus connections...");

  // Mutable refs held in an object so TS doesn't narrow to `never` in catch blocks
  const r: {
    redis: Redis | null;
    db: PostgresDb | null;
    adapter: DispatchAdapter | null;
    browser: Browser | null;
    page: Page | null;
    sessionCookie: string;
  } = { redis: null, db: null, adapter: null, browser: null, page: null, sessionCookie: "" };

  try {
    // ---- 1. Redis ----------------------------------------------------------
    log.info({ url: envVars.REDIS_URL }, "Creating Redis client");
    r.redis = createRedisClient(envVars.REDIS_URL);
    const pong = await r.redis.ping();
    if (pong !== "PONG") throw new Error(`Redis ping returned unexpected response: ${pong}`);
    log.info("Redis connection verified");

    // ---- 2. PostgreSQL -----------------------------------------------------
    log.info("Creating PostgreSQL client");
    r.db = createPostgresClient(envVars.POSTGRES_URL);
    await r.db.execute("SELECT 1" as any);
    log.info("PostgreSQL connection verified");

    // ---- 3. Dispatch adapter -----------------------------------------------
    log.info({ adapter: envVars.DISPATCH_ADAPTER }, "Creating dispatch adapter");
    r.adapter = createDispatchAdapterFromEnv(envVars);
    log.info("Dispatch adapter created");

    // ---- 4. Chrome via CDP (non-fatal) -------------------------------------
    log.info({ cdpUrl: envVars.CHROME_CDP_URL }, "Connecting to Chrome via CDP");
    try {
      r.browser = await connectBrowser(envVars.CHROME_CDP_URL);
      r.page = await createDispatchPage(r.browser);
      log.info("Chrome connection established");
    } catch (chromeErr) {
      log.warn({ err: chromeErr }, "Chrome not available — continuing without browser");
    }

    // ---- 5. Authenticate with dispatch (non-fatal) -------------------------
    if (r.page && r.adapter) {
      log.info("Authenticating with dispatch via browser");
      try {
        await r.adapter.login(r.page);
        log.info("Dispatch authentication successful");
      } catch (authErr) {
        log.warn({ err: authErr }, "Dispatch authentication failed — continuing");
      }
    }

    // ---- 6. Extract session cookie (non-fatal) -----------------------------
    if (r.page && r.adapter) {
      try {
        r.sessionCookie = await r.adapter.getSessionCookies(r.page);
        log.info({ hasCookie: r.sessionCookie.length > 0 }, "Session cookie extracted");
      } catch (cookieErr) {
        log.warn({ err: cookieErr }, "Failed to extract session cookie");
      }
    }

    log.info("All connections initialized successfully");

    return {
      redis: r.redis,
      db: r.db,
      adapter: r.adapter,
      sessionCookie: r.sessionCookie,
      browser: r.browser,
      page: r.page,
      wsClient: null,
    };
  } catch (err) {
    log.error({ err }, "Connection initialization failed, cleaning up");

    try { if (r.browser) await r.browser.close(); } catch { /* ignore */ }
    try { if (r.redis) r.redis.disconnect(); } catch { /* ignore */ }

    throw err;
  }
}
