/**
 * Shared agent state definition for the Sisyphus dispatch graph.
 *
 * Uses LangGraph.js Annotation to define the state shape shared across
 * all agent nodes (supervisor, market monitor, driver comms, customer
 * support, task executor). The `messages` field uses the built-in
 * message reducer that correctly handles append semantics and
 * RemoveMessage directives.
 *
 * @see planning/03-agent-design.md section 4.2
 */

import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

// ---------------------------------------------------------------------------
// Agent state annotation
// ---------------------------------------------------------------------------

/**
 * The canonical state flowing through every node in the dispatch graph.
 *
 * - `messages`        — Full chat history (system + human + AI + tool).
 *                       Uses the LangGraph messages reducer so nodes can
 *                       return a single message or array and it gets appended.
 * - `currentTask`     — Free-form description of the task the active agent
 *                       is working on (set by supervisor when delegating).
 * - `currentTaskType` — Structured task category used for model routing
 *                       (e.g. "monitoring", "messaging", "ticket_resolution").
 * - `needsEscalation` — Flag set by a sub-agent to signal the supervisor
 *                       that the current task requires escalation.
 * - `escalationReason`— Human-readable explanation for why escalation was
 *                       requested (populated alongside needsEscalation).
 * - `nextAgent`       — Routing target decided by the supervisor. One of
 *                       the sub-agent node names or "__end__" to finish.
 */
export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  currentTask: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  currentTaskType: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  needsEscalation: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),

  escalationReason: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  nextAgent: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

/** Convenience type for the full state object. */
export type AgentStateType = typeof AgentState.State;

/** Convenience type for partial updates returned by nodes. */
export type AgentStateUpdate = typeof AgentState.Update;
