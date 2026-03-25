/**
 * Main LangGraph dispatch graph — wires the supervisor and all
 * sub-agents into a single compiled StateGraph.
 *
 * Graph topology:
 *
 *   __start__ -> supervisor
 *   supervisor -> (conditional) -> market_monitor | driver_comms |
 *                                  customer_support | task_executor | __end__
 *   market_monitor   -> supervisor
 *   driver_comms     -> supervisor
 *   customer_support -> supervisor
 *   task_executor    -> supervisor
 *
 * The supervisor is the entry point and the only node that decides
 * routing. Sub-agents always return control to the supervisor after
 * completing their work.
 *
 * @see planning/03-agent-design.md section 5
 */

import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { Redis as RedisClient } from "ioredis";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import { AgentState, type AgentStateType } from "./state.js";
import { createChatModel } from "./llm-factory.js";
import {
  createSupervisorNode,
  AGENT_NAMES,
} from "./supervisor/agent.js";
import {
  createMarketMonitorNode,
  filterMarketMonitorTools,
  MARKET_MONITOR_NAME,
} from "./market-monitor/agent.js";
import {
  createDriverCommsNode,
  filterDriverCommsTools,
  DRIVER_COMMS_NAME,
} from "./driver-comms/agent.js";
import {
  createCustomerSupportNode,
  filterCustomerSupportTools,
  CUSTOMER_SUPPORT_NAME,
} from "./customer-support/agent.js";
import {
  createTaskExecutorNode,
  filterTaskExecutorTools,
  TASK_EXECUTOR_NAME,
} from "./task-executor/agent.js";
import { createOntologyTools } from "../tools/ontology-tools.js";
import {
  loadProcessDirectory,
  buildSystemPrompt,
} from "../tools/process-loader.js";
import type { OntologyStore } from "../ontology/state/index.js";
import { createChildLogger } from "../lib/index.js";

const log = createChildLogger("graph");

// ---------------------------------------------------------------------------
// Routing function
// ---------------------------------------------------------------------------

/**
 * Conditional edge resolver for the supervisor node.
 *
 * Reads `state.nextAgent` (set by the supervisor) and returns the
 * corresponding node name or END.
 */
function supervisorRouter(state: AgentStateType): string {
  const next = state.nextAgent;

  if (!next || next === "__end__") {
    return END;
  }

  // Validate that the target is a known agent
  if ((AGENT_NAMES as readonly string[]).includes(next)) {
    return next;
  }

  log.warn({ nextAgent: next }, "Unknown routing target — ending graph");
  return END;
}

// ---------------------------------------------------------------------------
// Graph factory
// ---------------------------------------------------------------------------

export interface CreateDispatchGraphOptions {
  /**
   * Checkpoint saver for conversation persistence.
   * Defaults to MemorySaver (in-memory, suitable for dev).
   * Pass a PostgresSaver for production use.
   */
  checkpointer?: BaseCheckpointSaver;
}

/**
 * Build and compile the full Sisyphus dispatch graph.
 *
 * @param store       The ontology state store (populated by sync layer).
 * @param redis       Redis client for cooldowns, timelines, action execution.
 * @param processDir  Path to the `processes/` directory containing .md files.
 * @param options     Optional overrides (checkpointer, etc.).
 * @returns The compiled LangGraph, ready to `.invoke()` or `.stream()`.
 */
export async function createDispatchGraph(
  store: OntologyStore,
  redis: RedisClient,
  processDir: string,
  options: CreateDispatchGraphOptions = {},
) {
  // -----------------------------------------------------------------------
  // 1. Load process files
  // -----------------------------------------------------------------------

  log.info({ processDir }, "Loading process files");
  const processes = await loadProcessDirectory(processDir);
  log.info({ count: processes.length }, "Process files loaded");

  // Build system prompts for each agent role
  const supervisorPrompt = buildSystemPrompt("supervisor", processes);
  const marketMonitorPrompt = buildSystemPrompt("market-monitor", processes);
  const driverCommsPrompt = buildSystemPrompt("driver-comms", processes);
  const customerSupportPrompt = buildSystemPrompt("customer-support", processes);
  const taskExecutorPrompt = buildSystemPrompt("task-executor", processes);

  // -----------------------------------------------------------------------
  // 2. Create ontology tools
  // -----------------------------------------------------------------------

  const allTools: DynamicStructuredTool[] = createOntologyTools(
    store,
    redis,
    "sisyphus",
  );

  // -----------------------------------------------------------------------
  // 3. Create LLM instances
  // -----------------------------------------------------------------------

  const defaultModel = createChatModel();
  // The supervisor may need more capable reasoning for triage decisions
  const supervisorModel = createChatModel("escalation_decision");

  // -----------------------------------------------------------------------
  // 4. Create agent nodes
  // -----------------------------------------------------------------------

  const supervisorNode = createSupervisorNode({
    systemPrompt: supervisorPrompt,
    ontologyTools: allTools,
    model: supervisorModel,
  });

  const marketMonitorNode = createMarketMonitorNode({
    processPrompt: marketMonitorPrompt,
    tools: filterMarketMonitorTools(allTools),
    model: defaultModel,
  });

  const driverCommsNode = createDriverCommsNode({
    processPrompt: driverCommsPrompt,
    tools: filterDriverCommsTools(allTools),
    model: defaultModel,
  });

  const customerSupportNode = createCustomerSupportNode({
    processPrompt: customerSupportPrompt,
    tools: filterCustomerSupportTools(allTools),
    model: defaultModel,
  });

  const taskExecutorNode = createTaskExecutorNode({
    processPrompt: taskExecutorPrompt,
    tools: filterTaskExecutorTools(allTools),
    model: defaultModel,
  });

  // -----------------------------------------------------------------------
  // 5. Build the graph
  // -----------------------------------------------------------------------

  log.info("Building dispatch graph");

  const graph = new StateGraph(AgentState)
    // Add all nodes
    .addNode("supervisor", supervisorNode)
    .addNode(MARKET_MONITOR_NAME, marketMonitorNode)
    .addNode(DRIVER_COMMS_NAME, driverCommsNode)
    .addNode(CUSTOMER_SUPPORT_NAME, customerSupportNode)
    .addNode(TASK_EXECUTOR_NAME, taskExecutorNode)

    // Entry point: every invocation starts at the supervisor
    .addEdge(START, "supervisor")

    // Supervisor routes to sub-agents or END via conditional edge
    .addConditionalEdges("supervisor", supervisorRouter, [
      MARKET_MONITOR_NAME,
      DRIVER_COMMS_NAME,
      CUSTOMER_SUPPORT_NAME,
      TASK_EXECUTOR_NAME,
      END,
    ])

    // All sub-agents return to the supervisor after completing their work
    .addEdge(MARKET_MONITOR_NAME, "supervisor")
    .addEdge(DRIVER_COMMS_NAME, "supervisor")
    .addEdge(CUSTOMER_SUPPORT_NAME, "supervisor")
    .addEdge(TASK_EXECUTOR_NAME, "supervisor");

  // -----------------------------------------------------------------------
  // 6. Compile with checkpointer
  // -----------------------------------------------------------------------

  const checkpointer = options.checkpointer ?? new MemorySaver();

  const compiled = graph.compile({ checkpointer });

  log.info("Dispatch graph compiled successfully");

  return compiled;
}
