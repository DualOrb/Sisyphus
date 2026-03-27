/**
 * Main LangGraph dispatch graph — wires the supervisor and all
 * sub-agents into a single compiled StateGraph.
 *
 * Graph topology (parallel dispatch):
 *
 *   __start__ -> supervisor
 *   supervisor -> (conditional) -> [Send("agent_a", ...), Send("agent_b", ...)]  (parallel)
 *                               -> __end__  (if no pending tasks)
 *   driver_comms     -> bridge -> supervisor
 *   customer_support -> bridge -> supervisor
 *   task_executor    -> bridge -> supervisor
 *
 * The supervisor sets `pendingTasks` — an array of task assignments.
 * The conditional edge reads that array and emits one `Send` per task,
 * triggering parallel sub-agent execution. When all parallel paths
 * complete, LangGraph merges results via the state reducer
 * (messagesStateReducer for messages) and re-invokes the supervisor.
 *
 * @see planning/03-agent-design.md section 5
 */

import { StateGraph, START, END, MemorySaver, Send } from "@langchain/langgraph";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { Redis as RedisClient } from "ioredis";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import { AgentState, type AgentStateType, type AgentStateUpdate } from "./state.js";
import { createChatModel } from "./llm-factory.js";
import {
  createSupervisorNode,
  AGENT_NAMES,
} from "./supervisor/agent.js";
import {
  filterDriverCommsTools,
  DRIVER_COMMS_NAME,
  DRIVER_COMMS_PREAMBLE,
} from "./driver-comms/agent.js";
import {
  filterCustomerSupportTools,
  CUSTOMER_SUPPORT_NAME,
  CUSTOMER_SUPPORT_PREAMBLE,
} from "./customer-support/agent.js";
import {
  filterTaskExecutorTools,
  TASK_EXECUTOR_NAME,
  TASK_EXECUTOR_PREAMBLE,
} from "./task-executor/agent.js";
import { createOntologyTools, createLocationHistoryTools } from "../tools/ontology-tools.js";
import { createProcessTools, initProcessRAG, buildProcessCatalog } from "../tools/process-tools.js";
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
import type { DriverLocationHistory } from "../ontology/state/location-history.js";
import { acquireLock, releaseLock } from "../memory/redis/locks.js";
import { recordAction } from "../memory/redis/action-timeline.js";
import { guessEntityType, guessEntityId } from "../lib/entity-helpers.js";
import { createChildLogger } from "../lib/index.js";

const log = createChildLogger("graph");

// ---------------------------------------------------------------------------
// Routing function (parallel dispatch via Send)
// ---------------------------------------------------------------------------

/**
 * Conditional edge resolver for the supervisor node.
 *
 * Reads `state.pendingTasks` (set by the supervisor) and returns an
 * array of `Send` objects for parallel dispatch, or `END` if there
 * are no tasks.
 *
 * Each `Send` copies the full message state into the target sub-agent
 * and sets `currentTask` / `currentTaskType` to the specific assignment.
 */
function supervisorRouter(state: AgentStateType): Send[] | typeof END {
  const tasks = state.pendingTasks;

  if (!tasks || tasks.length === 0) {
    return END;
  }

  // Validate and dispatch — one Send per task assignment
  const sends: Send[] = [];

  for (const task of tasks) {
    if (!(AGENT_NAMES as readonly string[]).includes(task.agent)) {
      log.warn({ agent: task.agent }, "Unknown agent in pendingTasks — skipping");
      continue;
    }

    sends.push(
      new Send(task.agent, {
        // Carry forward the full message history so sub-agents have context
        messages: state.messages,
        // Set the specific task for this sub-agent
        currentTask: task.task,
        currentTaskType: task.taskType,
        // Clear routing state for the sub-agent's execution
        nextAgent: "",
        pendingTasks: [],
        needsEscalation: state.needsEscalation,
        escalationReason: state.escalationReason,
      }),
    );
  }

  if (sends.length === 0) {
    log.warn("All tasks in pendingTasks had unknown agents — ending graph");
    return END;
  }

  log.info(
    { sendCount: sends.length, agents: sends.map((s) => s.node) },
    "Dispatching parallel sub-agents",
  );

  return sends;
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
   * Callback for full agent activity visibility. Called for every tool call,
   * tool result, and agent response across all agents.
   */
  onAgentActivity?: import("./create-agent.js").AgentActivityCallback;

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

  /**
   * Optional driver location history tracker. When provided, location
   * tools (get_driver_location, get_driver_location_history,
   * get_driver_distance_to) are added to the agent toolset.
   */
  locationHistory?: DriverLocationHistory;
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
    onAgentActivity,
    locationHistory,
  } = options;

  // -----------------------------------------------------------------------
  // 1. Load process files
  // -----------------------------------------------------------------------

  log.info({ processDir }, "Loading process files");
  const processes = await loadProcessDirectory(processDir);
  log.info({ count: processes.length }, "Process files loaded");

  // -----------------------------------------------------------------------
  // 1b. Initialize RAG vector store for semantic process lookup
  // -----------------------------------------------------------------------

  try {
    await initProcessRAG(processes);
    log.info("Process RAG initialized with local embeddings");
  } catch (err) {
    log.warn({ err }, "RAG initialization failed — falling back to keyword search");
  }

  // -----------------------------------------------------------------------
  // 1c. Build lean system prompts — global rules + process catalog only
  // -----------------------------------------------------------------------

  const globalRulesOnly = processes.filter(
    (p) => p.agent === "all" && p.trigger === "system",
  );
  const catalog = buildProcessCatalog(processes);

  // Each agent gets: AGENTS.md (~40 lines) + catalog (~30 lines) + preamble
  // Total: ~1K tokens. Full procedures loaded on-demand via lookup_process.
  const supervisorPrompt = buildSystemPrompt("supervisor", globalRulesOnly) + "\n\n" + catalog;
  const driverCommsPrompt = buildSystemPrompt("driver-comms", globalRulesOnly) + "\n\n" + catalog;
  const customerSupportPrompt = buildSystemPrompt("customer-support", globalRulesOnly) + "\n\n" + catalog;
  const taskExecutorPrompt = buildSystemPrompt("task-executor", globalRulesOnly) + "\n\n" + catalog;

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

  // Add location history tools if available
  const locationTools = createLocationHistoryTools(locationHistory ?? null, store);
  allTools.push(...locationTools);

  // -----------------------------------------------------------------------
  // 3. Create LLM instances
  // -----------------------------------------------------------------------

  const defaultModel = createChatModel();
  // Supervisor uses the same primary model — its job is routing
  // (reading the pre-built prompt and calling assign_tasks), not
  // complex reasoning. Fallback model is only used when the primary
  // is unreachable (handled by src/llm/client.ts).
  const supervisorModel = defaultModel;

  // -----------------------------------------------------------------------
  // 4. Create agent nodes
  // -----------------------------------------------------------------------

  const supervisorNode = createSupervisorNode({
    systemPrompt: supervisorPrompt,
    ontologyTools: allTools,
    model: supervisorModel,
    onActivity: onAgentActivity,
  });

  // Import createAgentNode directly so we can pass onActivity
  const { createAgentNode } = await import("./create-agent.js");

  const driverCommsNode = createAgentNode({
    name: DRIVER_COMMS_NAME,
    systemPrompt: DRIVER_COMMS_PREAMBLE + "\n\n" + driverCommsPrompt,
    tools: filterDriverCommsTools(allTools),
    model: defaultModel,
    onActivity: onAgentActivity,
  });

  const customerSupportNode = createAgentNode({
    name: CUSTOMER_SUPPORT_NAME,
    systemPrompt: CUSTOMER_SUPPORT_PREAMBLE + "\n\n" + customerSupportPrompt,
    tools: filterCustomerSupportTools(allTools),
    model: defaultModel,
    onActivity: onAgentActivity,
  });

  const taskExecutorNode = createAgentNode({
    name: TASK_EXECUTOR_NAME,
    systemPrompt: TASK_EXECUTOR_PREAMBLE + "\n\n" + taskExecutorPrompt,
    tools: filterTaskExecutorTools(allTools),
    model: defaultModel,
    maxIterations: 5, // Task executor is a utility — fewer iterations than reasoning agents
    onActivity: onAgentActivity,
  });

  // -----------------------------------------------------------------------
  // 5. Build the graph (parallel dispatch via Send)
  // -----------------------------------------------------------------------

  log.info("Building dispatch graph (parallel dispatch mode)");

  // Bridge node: ensures message history ends with a HumanMessage before
  // the supervisor is re-invoked. Some providers (Azure, Anthropic) reject
  // conversations that end with an assistant message.
  const bridgeNode = async (state: AgentStateType): Promise<AgentStateUpdate> => {
    const { HumanMessage: HM } = await import("@langchain/core/messages");

    // Surface escalation context directly in the bridge message so the
    // supervisor sees it prominently (not just as a state flag).
    let bridgeText = "Sub-agent work complete. Review the results above and decide: assign more tasks or call assign_tasks with an empty array to finish.";
    if (state.needsEscalation && state.escalationReason) {
      bridgeText =
        `⚠️ ESCALATION from sub-agent: ${state.escalationReason}\n\n` +
        `You MUST address this escalation before finishing. Either assign a sub-agent to handle it or acknowledge it.\n\n` +
        bridgeText;
    }

    return {
      messages: [new HM(bridgeText)],
    };
  };

  const graph = new StateGraph(AgentState)
    // Add all nodes
    .addNode("supervisor", supervisorNode)
    .addNode(DRIVER_COMMS_NAME, driverCommsNode)
    .addNode(CUSTOMER_SUPPORT_NAME, customerSupportNode)
    .addNode(TASK_EXECUTOR_NAME, taskExecutorNode)
    .addNode("bridge", bridgeNode)

    // Entry point: every invocation starts at the supervisor
    .addEdge(START, "supervisor")

    // Supervisor routes to sub-agents via Send[] for parallel dispatch,
    // or END if no tasks are pending.
    .addConditionalEdges("supervisor", supervisorRouter, [
      DRIVER_COMMS_NAME,
      CUSTOMER_SUPPORT_NAME,
      TASK_EXECUTOR_NAME,
      END,
    ])

    // All sub-agents return to the bridge node (not directly to supervisor).
    // The bridge injects a HumanMessage so providers that require
    // conversations to end with a user message don't reject the request.
    .addEdge(DRIVER_COMMS_NAME, "bridge")
    .addEdge(CUSTOMER_SUPPORT_NAME, "bridge")
    .addEdge(TASK_EXECUTOR_NAME, "bridge")
    .addEdge("bridge", "supervisor");

  // -----------------------------------------------------------------------
  // 6. Compile with checkpointer
  // -----------------------------------------------------------------------

  const checkpointer = options.checkpointer ?? new MemorySaver();

  const compiled = graph.compile({ checkpointer });

  log.info(
    onAudit ? "Dispatch graph compiled with custom audit tools (parallel dispatch)" : "Dispatch graph compiled successfully (parallel dispatch)",
  );

  return compiled;
}

// ---------------------------------------------------------------------------
// Custom execute_action tool with caller-provided audit callback
// ---------------------------------------------------------------------------

// Re-export entity helpers for backward compatibility with callers
// that import them from this module (e.g. init/services.ts).
export { guessEntityType, guessEntityId } from "../lib/entity-helpers.js";

/**
 * Build a custom `execute_action` tool that:
 * - Acquires a Redis lock on the target entity before execution (parallel safety)
 * - Passes the OntologyStore (as-is) to the execution context
 * - Invokes the caller-supplied `onAudit` callback
 * - Optionally records shadow proposals via ShadowExecutor
 * - Releases the lock after execution (success or failure)
 *
 * The lock prevents two parallel sub-agents from acting on the same
 * entity simultaneously (e.g., two agents both trying to reassign the
 * same order).
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
      "Available actions and their key params:\n" +
      "- AssignDriverToOrder: {orderId, driverId}\n" +
      "- ReassignOrder: {orderId, newDriverId, reason}\n" +
      "- SendDriverMessage: {driverId, message} (message max 500 chars)\n" +
      "- FollowUpWithDriver: {driverId, message}\n" +
      "- ResolveTicket: {ticketId, resolutionType: 'refund'|'credit'|'redelivery'|'apology'|'no_action', resolution: string (description), reason: string, refundAmount?: number (cents, required if resolutionType='refund')}\n" +
      "- EscalateTicket: {ticketId, reason}\n" +
      "- AddTicketNote: {ticketId, note}\n" +
      "- FlagMarketIssue: {market, issueType: 'low_drivers'|'high_demand'|'high_eta'|'unassigned_orders', severity: 'low'|'medium'|'high'|'critical', details}\n" +
      "- CancelOrder: {orderId, reason, cancellationOwner: 'ValleyEats'|'Restaurant'|'Driver'|'Customer'}",
    schema: z.object({
      actionName: z
        .string()
        .describe("The registered action name (e.g. 'SendDriverMessage', 'ReassignOrder')"),
      params: z
        .record(z.unknown())
        .describe("Action parameters as a JSON object (varies by action type)"),
      reasoning: z
        .string()
        .nullable()
        .optional()
        .describe("Your explanation of why you are taking this action (logged to audit trail)."),
    }).passthrough(),
    func: async (input) => {
      // Default reasoning if not provided
      const reasoning = input.reasoning ?? "No reasoning provided";
      // ------------------------------------------------------------------
      // Entity locking for parallel safety
      // ------------------------------------------------------------------
      const entityType = guessEntityType(input.actionName);
      const entityId = guessEntityId(input.params as Record<string, unknown>);
      let lockAcquired = false;

      if (entityType !== "unknown" && entityId !== "unknown") {
        try {
          const lockResult = await acquireLock(
            redis,
            entityType,
            entityId,
            agentId,
            300, // 5-minute TTL — shorter than default since parallel tasks are fast
          );

          if (!lockResult.acquired) {
            const holder = lockResult.holder?.agentId ?? "another agent";
            log.info(
              { entityType, entityId, holder, actionName: input.actionName },
              "Entity locked by another agent — skipping action",
            );
            return JSON.stringify({
              skipped: true,
              reason: `Entity ${entityType}:${entityId} is currently locked by ${holder}. Your action was NOT executed. Do NOT retry — include this in your summary so the supervisor can handle it on the next cycle.`,
            });
          }

          lockAcquired = true;
          log.debug(
            { entityType, entityId, actionName: input.actionName },
            "Entity lock acquired",
          );
        } catch (err) {
          // Lock acquisition failure should not block execution — log and continue
          log.warn({ err, entityType, entityId }, "Failed to acquire entity lock — proceeding without lock");
        }
      }

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

            // 2. Write to Redis entity timeline so agents can see
            //    what actions have already been taken on this entity
            //    via the get_entity_timeline tool.
            try {
              await recordAction(redis, entityType, entityId, {
                action: record.actionType,
                agent: record.agentId,
                outcome: record.outcome,
                reasoning: record.reasoning,
                contentPreview: typeof record.params === "object"
                  ? JSON.stringify(record.params).slice(0, 200)
                  : undefined,
              });
            } catch (err) {
              log.warn({ err, entityType, entityId }, "Failed to write action timeline");
            }

            // 3. Record shadow proposal for executed/staged actions
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
          reasoning,
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
      } finally {
        // Always release the lock after execution
        if (lockAcquired) {
          try {
            await releaseLock(redis, entityType, entityId, agentId);
            log.debug({ entityType, entityId }, "Entity lock released");
          } catch (err) {
            log.warn({ err, entityType, entityId }, "Failed to release entity lock");
          }
        }
      }
    },
  });
}
