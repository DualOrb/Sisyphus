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
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  AIMessage,
  SystemMessage,
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

  // ToolNode handles executing tool calls from AIMessages
  const toolNode = new ToolNode(tools);

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

      // Execute all requested tool calls via ToolNode
      const toolResult = await toolNode.invoke({
        messages: [...currentMessages, response],
      });

      // toolResult.messages contains ToolMessage responses
      const toolMessages: BaseMessage[] = toolResult.messages ?? [];

      // Only keep the new ToolMessages (the ones after our input)
      const newToolMessages = toolMessages.slice(currentMessages.length + 1);
      newMessages.push(...newToolMessages);

      // Check for escalation signals in tool responses
      for (const toolMsg of newToolMessages) {
        const content =
          typeof toolMsg.content === "string" ? toolMsg.content : "";
        if (content.includes('"status":"pending"') && content.includes('"requestId"')) {
          // A request_clarification tool was called — flag escalation
          needsEscalation = true;
          try {
            const parsed = JSON.parse(content) as { question?: string };
            escalationReason = parsed.question ?? "Clarification requested";
          } catch {
            escalationReason = "Clarification requested by agent";
          }
        }
      }

      // Prepare messages for next iteration (append new messages)
      currentMessages = [...currentMessages, response, ...newToolMessages];
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
