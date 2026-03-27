/**
 * Factory for creating LangGraph sub-agent nodes.
 *
 * Each sub-agent is a node function that:
 *   1. Prepends its system prompt to the message history
 *   2. Injects the specific task assignment (from parallel dispatch via
 *      `Send`) as a prominent system directive
 *   3. Calls the LLM (with tools bound)
 *   4. If the LLM requested tool calls, runs them via ToolNode
 *   5. Loops (call LLM / run tools) until the LLM produces a final
 *      text response with no further tool calls
 *   6. Returns updated messages to merge into graph state
 *
 * This is intentionally a "react-style" agent loop implemented inline
 * rather than using `createReactAgent`, so we retain full control over
 * state updates and can set escalation flags when needed.
 *
 * @see planning/03-agent-design.md section 2
 */

import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { Redis as RedisClient } from "ioredis";
import type { AgentStateType, AgentStateUpdate } from "./state.js";
import { sendHeartbeat } from "../memory/redis/heartbeat.js";
import { createChildLogger } from "../lib/index.js";

const log = createChildLogger("create-agent");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback for agent activity visibility. */
export type AgentActivityCallback = (entry: {
  agent: string;
  type: "tool_call" | "tool_result" | "response" | "summary";
  iteration: number;
  content: string;
}) => void;

export interface AgentNodeConfig {
  /** Unique name used for logging and graph node identification. */
  name: string;
  /** Full system prompt (built from AGENTS.md + process files). */
  systemPrompt: string;
  /** Ontology tools this agent is allowed to use. */
  tools: DynamicStructuredTool[];
  /** Pre-configured ChatOpenAI instance. */
  model: ChatOpenAI;
  /**
   * Maximum number of LLM-tool round-trips before the agent is forced
   * to return. Prevents runaway loops.  Default: 10.
   */
  maxIterations?: number;
  /**
   * Optional Redis client for sending agent heartbeats.
   * When provided, heartbeats are sent at the start and every 5 iterations.
   */
  redis?: RedisClient;
  /** Optional callback for full visibility into agent activity. */
  onActivity?: AgentActivityCallback;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a LangGraph node function for a sub-agent.
 *
 * The returned async function has the signature required by
 * `StateGraph.addNode()`:
 *   `(state: AgentStateType) => Promise<AgentStateUpdate>`
 */
export function createAgentNode(
  config: AgentNodeConfig,
): (state: AgentStateType) => Promise<AgentStateUpdate> {
  const { name, systemPrompt, tools, model, maxIterations = 10, redis, onActivity } = config;

  // Bind tools to the model so it knows what's available
  const modelWithTools =
    tools.length > 0 ? model.bindTools(tools) : model;

  // Build a lookup map for tools by name
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  return async (state: AgentStateType): Promise<AgentStateUpdate> => {
    log.info({ agent: name, task: state.currentTask, taskType: state.currentTaskType }, "Agent invoked");

    // Send initial heartbeat
    if (redis) {
      try {
        await sendHeartbeat(redis, name);
      } catch (err) {
        log.warn({ err, agent: name }, "Failed to send initial heartbeat");
      }
    }

    // Build the message list: system prompt + task directive + conversation history.
    // When dispatched via Send (parallel mode), each sub-agent receives a
    // specific `currentTask` describing exactly what it should work on.
    const systemMsg = new SystemMessage(systemPrompt);
    const preambleMessages: BaseMessage[] = [systemMsg];

    if (state.currentTask) {
      preambleMessages.push(
        new SystemMessage(
          `## YOUR ASSIGNED TASK\n\n` +
          `${state.currentTask}\n\n` +
          `## INSTRUCTIONS\n\n` +
          `**Prefer the data in your task description above.** Only call query tools (query_orders, query_drivers, etc.) if your task is missing specific IDs or details needed to take action.\n\n` +
          `**NEVER FABRICATE IDs.** If an order ID, ticket ID, or driver email is not in your task description, use the appropriate query tool to find it. Do NOT guess, invent, or construct IDs from entity names (e.g., "order_id_of_active_order_for_Alex_Quinton" is NOT a valid ID — you must query for the real one).\n\n` +
          `### BEFORE YOU ACT — CHECK THE TIMELINE\n` +
          `Call get_entity_timeline for EACH driver or order in your task BEFORE sending messages or taking actions. The timeline shows what was already done and when. Use it to decide:\n` +
          `- Was this driver already messaged recently? If <5 min ago, do NOT re-message.\n` +
          `- Was this order already assigned? If yes, don't re-assign.\n` +
          `- Is there a cooldown active? If so, skip and note it.\n\n` +
          `### Tools\n` +
          `- get_entity_timeline — call this FIRST for every entity\n` +
          `- execute_action — to take actions (SendDriverMessage, ResolveTicket, etc.)\n` +
          `- query_orders / query_drivers — ONLY if your task is missing an ID you need\n` +
          `- get_ticket_details / get_order_details — for detailed info not in your task\n` +
          `- lookup_process — if you need a specific procedure\n\n` +
          `**If an action returns cooldown_blocked or skipped, do NOT retry it.** Note it in your summary and move on.`,
        ),
      );
    }

    const inputMessages: BaseMessage[] = [...preambleMessages, ...state.messages];

    const newMessages: BaseMessage[] = [];
    let iterations = 0;
    let needsEscalation = false;
    let escalationReason = "";

    // Cache for deduplicating repeated tool calls within this invocation
    const toolCallCache = new Map<string, string>();

    // React-style loop: call LLM, run tools, repeat
    let currentMessages = inputMessages;

    while (iterations < maxIterations) {
      iterations += 1;

      // Send periodic heartbeat every 5 iterations
      if (redis && iterations % 5 === 0) {
        try {
          await sendHeartbeat(redis, name);
        } catch (err) {
          log.warn({ err, agent: name, iteration: iterations }, "Failed to send periodic heartbeat");
        }
      }

      // When one iteration remains, inject a system message forcing the
      // agent to summarise rather than making more tool calls. This
      // prevents messy cut-offs when hitting the iteration limit.
      if (iterations >= maxIterations) {
        currentMessages = [
          ...currentMessages,
          new SystemMessage(
            "You are on your FINAL iteration and will not get another turn. " +
            "Do NOT make any more tool calls. Instead, provide a brief summary of " +
            "what you have found so far and what actions you recommend. " +
            "Be concise and actionable.",
          ),
        ];
      }

      // Call the LLM
      const response = await modelWithTools.invoke(currentMessages);

      // response is a single BaseMessage (AIMessage)
      newMessages.push(response);

      // Check if the LLM requested tool calls
      const aiMsg = response as AIMessage;
      const toolCalls = aiMsg.tool_calls ?? [];

      if (toolCalls.length === 0) {
        // No tool calls — agent is done
        const text = typeof aiMsg.content === "string" ? aiMsg.content : JSON.stringify(aiMsg.content);
        log.info({ agent: name, iteration: iterations }, "Agent final response (no tools)");
        onActivity?.({ agent: name, type: "response", iteration: iterations, content: text });
        break;
      }

      // Log every tool call — full args, no truncation
      for (const tc of toolCalls) {
        const argsStr = JSON.stringify(tc.args);
        log.info({ agent: name, iteration: iterations, tool: tc.name }, "Agent tool call: %s", tc.name);
        onActivity?.({ agent: name, type: "tool_call", iteration: iterations, content: `${tc.name}(${argsStr})` });
      }

      // Execute each tool call and create matching ToolMessages
      // (must match 1:1 — providers like Anthropic/Vertex require every
      // tool_use to have a corresponding tool_result)
      const toolResponses: BaseMessage[] = [];

      for (const tc of toolCalls) {
        const tool = toolMap.get(tc.name);
        let content: string;

        // Check cache for duplicate tool calls (same name + same args)
        const cacheKey = `${tc.name}:${JSON.stringify(tc.args)}`;
        const cachedResult = toolCallCache.get(cacheKey);

        if (cachedResult !== undefined) {
          // Tell the LLM this is a repeat call with the same result — stop retrying
          content = cachedResult + "\n[NOTE: This is the same result as a previous identical call. Do NOT retry the same query — try different parameters or move on.]";
          log.debug({ agent: name, toolName: tc.name }, "Cached tool result for %s (repeat call)", tc.name);
        } else if (tool) {
          try {
            const result = await (tool as any).invoke(tc.args);
            content = typeof result === "string" ? result : JSON.stringify(result);
          } catch (err: any) {
            content = JSON.stringify({ error: err.message ?? "Tool execution failed" });
          }
          toolCallCache.set(cacheKey, content);
        } else {
          content = JSON.stringify({ error: `Unknown tool: ${tc.name}` });
        }

        toolResponses.push(new ToolMessage({
          content,
          tool_call_id: tc.id ?? tc.name,
          name: tc.name,
        }));

        onActivity?.({ agent: name, type: "tool_result", iteration: iterations, content: `${tc.name} → ${content}` });

        // Check for escalation signals
        if (content.includes('"status":"pending"') && content.includes('"requestId"')) {
          needsEscalation = true;
          try {
            const parsed = JSON.parse(content) as { question?: string };
            escalationReason = parsed.question ?? "Clarification requested";
          } catch {
            escalationReason = "Clarification requested by agent";
          }
        }
      }

      newMessages.push(...toolResponses);

      // Detect cooldown/skip blocks and inject a hard stop to prevent retries
      const hasBlock = toolResponses.some((tr) => {
        const content = typeof (tr as any).content === "string" ? (tr as any).content : "";
        return content.includes('"cooldown_blocked"') ||
               content.includes('"skipped":true') ||
               content.includes('"outcome":"cooldown_blocked"');
      });

      if (hasBlock) {
        const stopMsg = new SystemMessage(
          "[SYSTEM] One or more of your actions was BLOCKED by a cooldown or entity lock. " +
          "Do NOT retry blocked actions. Move on to any remaining unblocked work, or if all work is blocked, " +
          "provide your summary now. List the blocked actions in your summary.",
        );
        currentMessages = [...currentMessages, response, ...toolResponses, stopMsg];
      } else {
        currentMessages = [...currentMessages, response, ...toolResponses];
      }
    }

    if (iterations >= maxIterations) {
      log.warn({ agent: name, iterations }, "Agent hit max iterations — forcing return");
      // Capture the last AI message as the summary — full content
      const lastMsg = newMessages[newMessages.length - 1];
      if (lastMsg) {
        const text = typeof (lastMsg as any).content === "string" ? (lastMsg as any).content : "";
        onActivity?.({ agent: name, type: "summary", iteration: iterations, content: text });
      }
    }

    log.info(
      { agent: name, iterations, messageCount: newMessages.length },
      "Agent completed",
    );

    return {
      messages: newMessages,
      ...(needsEscalation && { needsEscalation: true, escalationReason }),
    };
  };
}
