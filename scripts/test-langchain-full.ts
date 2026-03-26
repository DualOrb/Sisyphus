import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { OntologyStore } from "../src/ontology/state/store.js";
import { createRedisClient } from "../src/memory/redis/client.js";
import { createOntologyTools } from "../src/tools/ontology-tools.js";
import { loadProcessDirectory, buildSystemPrompt } from "../src/tools/process-loader.js";

const model = new ChatOpenAI({
  modelName: process.env.LLM_MODEL,
  openAIApiKey: process.env.LLM_API_KEY,
  configuration: { baseURL: process.env.LLM_BASE_URL },
  temperature: 0,
});

const store = new OntologyStore();
const redis = createRedisClient(process.env.REDIS_URL ?? "redis://localhost:6379/0");

console.log("Model:", process.env.LLM_MODEL);

// Create all tools
const tools = createOntologyTools(store, redis, "test");
console.log(`Tools created: ${tools.length} (${tools.map(t => t.name).join(", ")})`);

// Load process files
const processes = await loadProcessDirectory("processes");
const prompt = buildSystemPrompt("supervisor", processes);
console.log(`System prompt: ${prompt.length} chars from ${processes.length} process files`);

// Bind all tools
const bound = model.bindTools(tools);

try {
  console.log("\nCalling with all tools + system prompt...");
  const result = await bound.invoke([
    new SystemMessage(prompt.slice(0, 4000)), // Truncate to avoid token limits
    new HumanMessage("There are 3 late orders in Pembroke. What should we do?"),
  ]);
  console.log("\nSUCCESS");
  console.log("Content:", (result.content as string)?.slice(0, 500));
  console.log("Tool calls:", JSON.stringify(result.tool_calls, null, 2));
} catch (err: any) {
  console.log("\nERROR:", err.message);
  if (err.error) console.log("Error body:", JSON.stringify(err.error, null, 2));

  // Try with fewer tools
  console.log("\nRetrying with just 3 tools...");
  const fewTools = tools.slice(0, 3);
  const bound2 = model.bindTools(fewTools);
  try {
    const result2 = await bound2.invoke([
      new HumanMessage("There are 3 late orders in Pembroke. What should we do?"),
    ]);
    console.log("SUCCESS with 3 tools");
    console.log("Content:", (result2.content as string)?.slice(0, 300));
    console.log("Tool calls:", JSON.stringify(result2.tool_calls, null, 2));
  } catch (err2: any) {
    console.log("STILL FAILED with 3 tools:", err2.message);
  }

  // Try with no system prompt
  console.log("\nRetrying all tools but no system prompt...");
  try {
    const result3 = await bound.invoke([
      new HumanMessage("Check for pending orders"),
    ]);
    console.log("SUCCESS without system prompt");
    console.log("Tool calls:", JSON.stringify(result3.tool_calls, null, 2));
  } catch (err3: any) {
    console.log("STILL FAILED without system prompt:", err3.message);
  }
}

redis.disconnect();
