import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { HumanMessage } from "@langchain/core/messages";

const model = new ChatOpenAI({
  modelName: process.env.LLM_MODEL,
  openAIApiKey: process.env.LLM_API_KEY,
  configuration: { baseURL: process.env.LLM_BASE_URL },
  temperature: 0,
});

const testTool = new DynamicStructuredTool({
  name: "query_orders",
  description: "Query orders with optional filters",
  schema: z.object({
    status: z.string().nullable().optional().describe("Filter by status"),
  }),
  func: async () => JSON.stringify({ count: 0, orders: [] }),
});

const bound = model.bindTools([testTool]);

try {
  console.log("Model:", process.env.LLM_MODEL);
  console.log("Calling with 1 tool...");
  const result = await bound.invoke([
    new HumanMessage("Check if there are any pending orders"),
  ]);
  console.log("SUCCESS");
  console.log("Content:", result.content);
  console.log("Tool calls:", JSON.stringify(result.tool_calls, null, 2));
} catch (err: any) {
  console.log("ERROR:", err.message);
  // Try to get the actual error body
  if (err.error) console.log("Error body:", JSON.stringify(err.error, null, 2));
  if (err.code) console.log("Code:", err.code);
  if (err.status) console.log("Status:", err.status);
  if (err.headers) {
    const h = Object.fromEntries(err.headers.entries?.() ?? []);
    console.log("Headers:", JSON.stringify(h));
  }
  // The raw response might be in err.response
  if (err.response) {
    try {
      const text = await err.response.text();
      console.log("Response body:", text);
    } catch {}
  }
}
