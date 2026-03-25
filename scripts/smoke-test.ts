/**
 * Smoke test — verifies real infrastructure connections.
 *
 * Run: npx tsx scripts/smoke-test.ts
 *
 * Tests:
 *   1. Redis ping
 *   2. PostgreSQL connection + schema creation
 *   3. DynamoDB scan (2 orders) via AWS SDK
 *   4. OpenRouter LLM call
 *   5. Ontology store populated from DynamoDB
 */

import "dotenv/config";
import { createRedisClient } from "../src/memory/redis/client.js";
import { createPostgresClient } from "../src/memory/postgres/client.js";
import { OntologyStore } from "../src/ontology/state/store.js";
import { transformOrder, transformDriver, transformMarket } from "../src/ontology/sync/transformer.js";
import { callLlm } from "../src/llm/client.js";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ${PASS} ${name}`);
    passed++;
  } catch (err: any) {
    console.log(`  ${FAIL} ${name}`);
    console.log(`    ${err.message ?? err}`);
    failed++;
  }
}

console.log("\n\x1b[1m  Sisyphus Smoke Test\x1b[0m\n");

// 1. Redis
await test("Redis ping", async () => {
  const redis = createRedisClient(process.env.REDIS_URL ?? "redis://localhost:6379/0");
  const pong = await redis.ping();
  if (pong !== "PONG") throw new Error(`Expected PONG, got ${pong}`);
  redis.disconnect();
});

// 2. PostgreSQL
await test("PostgreSQL connection", async () => {
  const db = createPostgresClient(
    process.env.POSTGRES_URL ?? "postgresql://sisyphus:sisyphus@localhost:5432/sisyphus",
  );
  await db.execute("SELECT 1" as any);
});

// 3. PostgreSQL schema (create tables if they don't exist)
await test("PostgreSQL schema migration", async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL ?? "postgresql://sisyphus:sisyphus@localhost:5432/sisyphus",
  });

  // Create tables from our Drizzle schema (manual DDL for smoke test)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shift_id UUID NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      agent_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      task_id TEXT,
      params JSONB,
      reasoning TEXT,
      submission_check JSONB,
      outcome TEXT,
      before_state JSONB,
      after_state JSONB,
      side_effects_fired JSONB,
      execution_time_ms INTEGER,
      llm_model TEXT,
      llm_tokens_used INTEGER,
      correlation_id TEXT
    );

    CREATE TABLE IF NOT EXISTS shift_summary (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shift_date DATE NOT NULL,
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ,
      total_actions INTEGER DEFAULT 0,
      orders_handled INTEGER DEFAULT 0,
      tickets_resolved INTEGER DEFAULT 0,
      messages_sent INTEGER DEFAULT 0,
      escalations INTEGER DEFAULT 0,
      issues JSONB,
      notes TEXT,
      market_summary JSONB
    );

    CREATE TABLE IF NOT EXISTS entity_interactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      interaction_type TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      summary TEXT,
      sentiment TEXT,
      resolved BOOLEAN DEFAULT FALSE,
      context JSONB
    );

    CREATE TABLE IF NOT EXISTS shadow_proposals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shift_date DATE,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      action_name TEXT NOT NULL,
      params JSONB,
      tier TEXT,
      would_execute_via TEXT,
      reasoning TEXT,
      agent_id TEXT,
      validation_passed BOOLEAN,
      validation_errors JSONB,
      human_decision TEXT,
      human_note TEXT,
      reviewed_at TIMESTAMPTZ
    );
  `);

  const res = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
  );
  const tables = res.rows.map((r: any) => r.table_name);
  if (!tables.includes("audit_log")) throw new Error("audit_log table not found");
  if (!tables.includes("shift_summary")) throw new Error("shift_summary table not found");
  if (!tables.includes("shadow_proposals")) throw new Error("shadow_proposals table not found");
  await pool.end();
});

// 4. DynamoDB — fetch 2 real orders
let realOrders: any[] = [];
await test("DynamoDB scan (2 orders from ValleyEats-Orders)", async () => {
  const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  const result = await dynamo.send(
    new ScanCommand({
      TableName: "ValleyEats-Orders",
      Limit: 2,
    }),
  );
  if (!result.Items || result.Items.length === 0) throw new Error("No orders found");
  realOrders = result.Items.map((item) => unmarshall(item));
  console.log(`    → Got ${realOrders.length} orders (first: ${realOrders[0].OrderIdKey})`);
});

// 5. DynamoDB — fetch 2 real drivers
let realDrivers: any[] = [];
await test("DynamoDB scan (2 drivers from ValleyEats-Drivers)", async () => {
  const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  const result = await dynamo.send(
    new ScanCommand({
      TableName: "ValleyEats-Drivers",
      Limit: 2,
    }),
  );
  if (!result.Items || result.Items.length === 0) throw new Error("No drivers found");
  realDrivers = result.Items.map((item) => unmarshall(item));
  console.log(`    → Got ${realDrivers.length} drivers (first: ${realDrivers[0].FullName ?? realDrivers[0].DriverId})`);
});

// 6. DynamoDB — fetch market meters
await test("DynamoDB scan (markets from ValleyEats-MarketMeters)", async () => {
  const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  const result = await dynamo.send(
    new ScanCommand({
      TableName: "ValleyEats-MarketMeters",
      Limit: 5,
    }),
  );
  if (!result.Items || result.Items.length === 0) throw new Error("No markets found");
  const markets = result.Items.map((item) => unmarshall(item));
  console.log(`    → Got ${markets.length} markets: ${markets.map((m) => m.Market).join(", ")}`);
});

// 7. Transform real DynamoDB data into ontology objects
await test("Transform real orders into ontology objects", async () => {
  const store = new OntologyStore();
  const orders = realOrders.map(transformOrder);
  store.updateOrders(orders);
  const stats = store.getStats();
  if (stats.orders !== realOrders.length) throw new Error(`Expected ${realOrders.length} orders, got ${stats.orders}`);
  const first = orders[0];
  console.log(`    → Order ${first.orderIdKey}: status=${first.status}, zone=${first.deliveryZone}, restaurant=${first.restaurantName}`);
});

await test("Transform real drivers into ontology objects", async () => {
  const drivers = realDrivers.map(transformDriver);
  const first = drivers[0];
  console.log(`    → Driver ${first.name}: zone=${first.dispatchZone}, available=${first.isAvailable}, online=${first.isOnline}`);
});

// 8. LLM call via OpenRouter
await test("OpenRouter LLM call (qwen3-30b-a3b)", async () => {
  const response = await callLlm([
    {
      role: "system",
      content: "You are a dispatch AI. Respond in one short sentence.",
    },
    {
      role: "user",
      content: "There are 3 unassigned orders in Perth and only 1 available driver. What should we do?",
    },
  ]);

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from LLM");
  console.log(`    → LLM: "${content.slice(0, 100)}${content.length > 100 ? "..." : ""}"`);
});

// Summary
console.log(`\n  ─────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
