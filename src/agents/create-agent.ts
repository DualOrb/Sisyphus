/**
 * Factory for creating LangGraph sub-agent nodes.
 *
 * Each sub-agent is a node function that:
 *   1. Prepends its system prompt to the message history
 *   2. Calls the LLM (with tools bound)
 *   3. If the LLM requested tool calls, runs them via ToolNode
 *   4. Loops (call LLM / run tools) until the LLM produces a final
 *      text response with no further tool calls
 *   5. Returns updated messages to merge into graph state
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
import type { AgentStateType, AgentStateUpdate } from "./state.js";
import { createChildLogger } from "../lib/index.js";

const log = createChildLogger("create-agent");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  const { name, systemPrompt, tools, model, maxIterations = 10 } = config;

  // Bind tools to the model so it knows what's available
  const modelWithTools =
    tools.length > 0 ? model.bindTools(tools) : model;

  // Build a lookup map for tools by name
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  return async (state: AgentStateType): Promise<AgentStateUpdate> => {
    log.info({ agent: name, task: state.currentTask }, "Agent invoked");

    // Build the message list: system prompt + conversation history
    const systemMsg = new SystemMessage(systemPrompt);
    const inputMessages: BaseMessage[] = [systemMsg, ...state.messages];

    const newMessages: BaseMessage[] = [];
    let iterations = 0;
    let needsEscalation = false;
    let escalationReason = "";

    // React-style loop: call LLM, run tools, repeat
    let currentMessages = inputMessages;

    while (iterations < maxIterations) {
      iterations += 1;

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
        break;
      }

      // Execute each tool call and create matching ToolMessages
      // (must match 1:1 — providers like Anthropic/Vertex require every
      // tool_use to have a corresponding tool_result)
      const toolResponses: BaseMessage[] = [];

      for (const tc of toolCalls) {
        const tool = toolMap.get(tc.name);
        let content: string;

        if (tool) {
          try {
            const result = await (tool as any).invoke(tc.args);
            content = typeof result === "string" ? result : JSON.stringify(result);
          } catch (err: any) {
            content = JSON.stringify({ error: err.message ?? "Tool execution failed" });
          }
        } else {
          content = JSON.stringify({ error: `Unknown tool: ${tc.name}` });
        }

        toolResponses.push(new ToolMessage({
          content,
          tool_call_id: tc.id ?? tc.name,
          name: tc.name,
        }));

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
      currentMessages = [...currentMessages, response, ...toolResponses];
    }

    if (iterations >= maxIterations) {
      log.warn(
        { agent: name, iterations },
        "Agent hit max iterations — forcing return",
      );
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
