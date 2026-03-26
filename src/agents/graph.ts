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
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
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
import { createProcessTools } from "../tools/process-tools.js";
import {
  loadProcessDirectory,
  buildSystemPrompt,
  selectRelevantProcesses,
  type ProcessSelectionContext,
} from "../tools/process-loader.js";
import { executeAction } from "../guardrails/executor.js";
import type { ExecutionContext, AuditRecord } from "../guardrails/types.js";
import type { ShadowExecutor } from "../execution/shadow/executor.js";
import type { ShadowMetrics } from "../execution/shadow/metrics.js";
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

/**
 * Callback invoked by the custom execute_action tool whenever an audit
 * record is produced by the guardrails pipeline. Use this to wire
 * PostgreSQL writes, shadow proposal tracking, or any other side channel.
 */
export type OnAuditCallback = (record: AuditRecord) => void | Promise<void>;

export interface CreateDispatchGraphOptions {
  /**
   * Checkpoint saver for conversation persistence.
   * Defaults to MemorySaver (in-memory, suitable for dev).
   * Pass a PostgresSaver for production use.
   */
  checkpointer?: BaseCheckpointSaver;

  /**
   * Optional audit callback wired into the execute_action tool.
   * When provided, a custom execute_action tool is created that passes
   * the OntologyStore (not a plain object) as state and invokes this
   * callback on every audit record.
   */
  onAudit?: OnAuditCallback;

  /**
   * Optional ShadowExecutor instance. When provided together with
   * onAudit, executed/staged actions also generate shadow proposals.
   */
  shadowExecutor?: ShadowExecutor;

  /**
   * Optional ShadowMetrics instance for tracking proposal statistics.
   */
  shadowMetrics?: ShadowMetrics;

  /**
   * Correlation / shift ID attached to the execution context.
   * Defaults to a random UUID if not provided.
   */
  correlationId?: string;

  /**
   * Process selection context used by selectRelevantProcesses.
   * When provided, the graph uses selectRelevantProcesses to build
   * lean per-agent prompts instead of loading ALL process files.
   * Agents can still fetch additional procedures via lookup_process.
   */
  processSelectionContext?: ProcessSelectionContext;
}

/**
 * Build and compile the full Sisyphus dispatch graph.
 *
 * @param store       The ontology state store (populated by sync layer).
 * @param redis       Redis client for cooldowns, timelines, action execution.
 * @param processDir  Path to the `processes/` directory containing .md files.
 * @param options     Optional overrides (checkpointer, onAudit, shadow, etc.).
 * @returns The compiled LangGraph, ready to `.invoke()` or `.stream()`.
 */
export async function createDispatchGraph(
  store: OntologyStore,
  redis: RedisClient,
  processDir: string,
  options: CreateDispatchGraphOptions = {},
) {
  const {
    onAudit,
    shadowExecutor,
    correlationId,
    processSelectionContext,
  } = options;

  // -----------------------------------------------------------------------
  // 1. Load process files
  // -----------------------------------------------------------------------

  log.info({ processDir }, "Loading process files");
  const processes = await loadProcessDirectory(processDir);
  log.info({ count: processes.length }, "Process files loaded");

  // -----------------------------------------------------------------------
  // 1b. Build system prompts — use selectRelevantProcesses when a
  //     context is provided (production), otherwise load ALL per agent.
  // -----------------------------------------------------------------------

  let supervisorPrompt: string;
  let marketMonitorPrompt: string;
  let driverCommsPrompt: string;
  let customerSupportPrompt: string;
  let taskExecutorPrompt: string;

  if (processSelectionContext) {
    // Production path: lean per-agent prompts using selectRelevantProcesses.
    // Agents can still fetch additional procedures via the lookup_process tool.
    const supervisorBase = selectRelevantProcesses(processes, "supervisor", processSelectionContext);
    const marketMonitorBase = selectRelevantProcesses(processes, "market-monitor", processSelectionContext);
    const driverCommsBase = selectRelevantProcesses(processes, "driver-comms", processSelectionContext);
    const customerSupportBase = selectRelevantProcesses(processes, "customer-support", processSelectionContext);
    const taskExecutorBase = selectRelevantProcesses(processes, "task-executor", processSelectionContext);

    log.info(
      {
        supervisor: supervisorBase.length,
        marketMonitor: marketMonitorBase.length,
        driverComms: driverCommsBase.length,
        customerSupport: customerSupportBase.length,
        taskExecutor: taskExecutorBase.length,
        totalLibrary: processes.length,
      },
      "Base process files selected per agent (full library available via lookup_process tool)",
    );

    supervisorPrompt = buildSystemPrompt("supervisor", supervisorBase);
    marketMonitorPrompt = buildSystemPrompt("market-monitor", marketMonitorBase);
    driverCommsPrompt = buildSystemPrompt("driver-comms", driverCommsBase);
    customerSupportPrompt = buildSystemPrompt("customer-support", customerSupportBase);
    taskExecutorPrompt = buildSystemPrompt("task-executor", taskExecutorBase);
  } else {
    // Dev path: load all process files per agent (original behaviour).
    supervisorPrompt = buildSystemPrompt("supervisor", processes);
    marketMonitorPrompt = buildSystemPrompt("market-monitor", processes);
    driverCommsPrompt = buildSystemPrompt("driver-comms", processes);
    customerSupportPrompt = buildSystemPrompt("customer-support", processes);
    taskExecutorPrompt = buildSystemPrompt("task-executor", processes);
  }

  // -----------------------------------------------------------------------
  // 2. Create ontology tools
  // -----------------------------------------------------------------------

  const baseTools: DynamicStructuredTool[] = createOntologyTools(
    store,
    redis,
    "sisyphus",
  );

  // When an onAudit callback is provided, replace the default execute_action
  // tool with one that passes the OntologyStore as state and wires the audit
  // callback (same pattern as shadow-live.ts).
  let allTools: DynamicStructuredTool[];
  if (onAudit) {
    allTools = baseTools.filter((t) => t.name !== "execute_action");
    allTools.push(
      createCustomExecuteActionTool(store, redis, "sisyphus", onAudit, {
        correlationId,
        shadowExecutor,
      }),
    );
  } else {
    allTools = baseTools;
  }

  // Add process retrieval tools — agents can search the full library on demand
  const processTools = createProcessTools(processes);
  allTools.push(...processTools);

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

  log.info(
    onAudit ? "Dispatch graph compiled with custom audit tools" : "Dispatch graph compiled successfully",
  );

  return compiled;
}

// ---------------------------------------------------------------------------
// Custom execute_action tool with caller-provided audit callback
// ---------------------------------------------------------------------------

/**
 * Infer entity type from an action name (e.g. "AssignDriverToOrder" -> "order").
 */
export function guessEntityType(actionType: string): string {
  if (actionType.includes("Order") || actionType.includes("Assign") || actionType.includes("Reassign"))
    return "order";
  if (actionType.includes("Driver") || actionType.includes("FollowUp"))
    return "driver";
  if (actionType.includes("Ticket") || actionType.includes("Escalate"))
    return "ticket";
  if (actionType.includes("Market")) return "market";
  return "unknown";
}

/**
 * Best-effort extraction of the primary entity ID from action params.
 */
export function guessEntityId(params: Record<string, unknown>): string {
  return (
    (params.orderId as string) ??
    (params.order_id as string) ??
    (params.driverId as string) ??
    (params.driver_id as string) ??
    (params.ticketId as string) ??
    (params.ticket_id as string) ??
    (params.market as string) ??
    "unknown"
  );
}

/**
 * Build a custom `execute_action` tool that:
 * - Passes the OntologyStore (as-is) to the execution context
 * - Invokes the caller-supplied `onAudit` callback
 * - Optionally records shadow proposals via ShadowExecutor
 *
 * This mirrors what shadow-live.ts does, but lives in core so both the
 * production init system and shadow-live can share the same logic.
 */
function createCustomExecuteActionTool(
  store: OntologyStore,
  redis: RedisClient,
  agentId: string,
  onAudit: OnAuditCallback,
  extra: {
    correlationId?: string;
    shadowExecutor?: ShadowExecutor;
  } = {},
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "execute_action",
    description:
      "Execute a named action through the ontology guardrails pipeline. The action will be " +
      "validated against submission criteria, checked for cooldowns and rate limits, and " +
      "executed according to its autonomy tier (GREEN/YELLOW auto-execute, ORANGE staged " +
      "for review, RED requires human approval). ALWAYS provide a clear reasoning string " +
      "explaining why you chose this action — it is logged to the audit trail.\n\n" +
      "Available actions include: AssignDriverToOrder, ReassignOrder, UpdateOrderStatus, " +
      "CancelOrder, SendDriverMessage, FollowUpWithDriver, ResolveTicket, EscalateTicket, " +
      "AddTicketNote, FlagMarketIssue, and more.",
    schema: z.object({
      actionName: z
        .string()
        .describe("The registered action name (e.g. 'SendDriverMessage', 'ReassignOrder')"),
      params: z
        .record(z.unknown())
        .describe("Action parameters as a JSON object (varies by action type)"),
      reasoning: z
        .string()
        .describe("Your explanation of why you are taking this action. This is logged to the audit trail."),
    }),
    func: async (input) => {
      try {
        const executionContext: ExecutionContext = {
          redis,
          state: store as unknown as Record<string, unknown>,
          correlationId: extra.correlationId,
          llmModel: process.env.LLM_MODEL ?? "unknown",
          llmTokensUsed: 0,
          onAudit: async (record: AuditRecord) => {
            // 1. Invoke the caller-provided audit callback
            await onAudit(record);

            // 2. Record shadow proposal for executed/staged actions
            if (extra.shadowExecutor && (record.outcome === "executed" || record.outcome === "staged")) {
              extra.shadowExecutor.setContext({
                tier: "YELLOW",
                reasoning: record.reasoning,
                agentId: record.agentId,
                validationResult: {
                  passed: true,
                },
              });
              await extra.shadowExecutor.execute(record.actionType, record.params);
            }
          },
        };

        const result = await executeAction(
          input.actionName,
          input.params,
          input.reasoning,
          agentId,
          executionContext,
        );

        return JSON.stringify(result);
      } catch (err) {
        log.error({ err, input }, "execute_action failed");
        return JSON.stringify({
          error: "Failed to execute action",
          details: String(err),
        });
      }
    },
  });
}
