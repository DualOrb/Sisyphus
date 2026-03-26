import "dotenv/config";
import { HumanMessage } from "@langchain/core/messages";
import { OntologyStore } from "../src/ontology/state/store.js";
import { createRedisClient } from "../src/memory/redis/client.js";
import { createDispatchGraph } from "../src/agents/graph.js";
import { registerAllActions } from "../src/ontology/actions/index.js";

console.log("Model:", process.env.LLM_MODEL);
console.log("Registering actions...");
await registerAllActions();

const store = new OntologyStore();
const redis = createRedisClient(process.env.REDIS_URL ?? "redis://localhost:6379/0");

console.log("Building graph...");
// Use a minimal processes dir to keep prompt small
import { mkdirSync, writeFileSync, existsSync } from "fs";
const testProcessDir = "/tmp/sisyphus-test-processes";
if (!existsSync(testProcessDir)) {
  mkdirSync(testProcessDir, { recursive: true });
  writeFileSync(`${testProcessDir}/AGENTS.md`, `---
agent: all
trigger: system
priority: critical
version: "1.0"
---
# Sisyphus — AI Dispatcher
You are an AI dispatcher. Route tasks to sub-agents or respond with __end__ if nothing needs attention.
`);
}
const graph = await createDispatchGraph(store, redis, testProcessDir);
console.log("Graph compiled.");

// Add debug hook to the supervisor to see what's being sent
const origInvoke = graph.invoke.bind(graph);
console.log("\nInvoking graph (with debug)...");
try {
  const result = await graph.invoke(
    {
      messages: [new HumanMessage("There are 2 orders in Pembroke, all running normally. No issues detected. What do you do?")],
    },
    { configurable: { thread_id: `test-${Date.now()}` } },
  );
  console.log("\nSUCCESS");
  const lastMsg = result.messages[result.messages.length - 1];
  console.log("Last message type:", lastMsg.constructor.name);
  console.log("Content:", typeof lastMsg.content === "string" ? lastMsg.content.slice(0, 500) : JSON.stringify(lastMsg.content).slice(0, 500));
  console.log("Next agent:", result.nextAgent);
} catch (err: any) {
  console.log("\nERROR:", err.message);

  // Check if it's a nested error
  if (err.cause) console.log("Cause:", err.cause.message ?? err.cause);

  // Try to get response body
  if (err.error) console.log("Error body:", JSON.stringify(err.error).slice(0, 500));
  if (err.status) console.log("HTTP status:", err.status);

  // Check the raw response
  try {
    const raw = JSON.parse(err.message.split("\n").slice(1).join("\n"));
    console.log("Parsed error:", raw);
  } catch {}
}

redis.disconnect();
process.exit(0);
