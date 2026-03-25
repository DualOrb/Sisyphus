import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  date,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// audit_log — every action Sisyphus takes, permanently
// ---------------------------------------------------------------------------

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shiftId: uuid("shift_id").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    agentId: text("agent_id").notNull(),
    actionType: text("action_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    taskId: text("task_id"),
    params: jsonb("params"),
    reasoning: text("reasoning"),
    submissionCheck: jsonb("submission_check"),
    outcome: text("outcome"),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    sideEffectsFired: jsonb("side_effects_fired"),
    executionTimeMs: integer("execution_time_ms"),
    llmModel: text("llm_model"),
    llmTokensUsed: integer("llm_tokens_used"),
    correlationId: text("correlation_id"),
  },
  (table) => [
    index("idx_audit_log_entity").on(table.entityType, table.entityId, table.timestamp),
    index("idx_audit_log_shift").on(table.shiftId, table.timestamp),
    index("idx_audit_log_action_type").on(table.actionType, table.timestamp),
    index("idx_audit_log_agent").on(table.agentId, table.timestamp),
  ],
);

export type AuditLogRecord = typeof auditLog.$inferInsert;
export type AuditLogRow = typeof auditLog.$inferSelect;

// ---------------------------------------------------------------------------
// shift_summary — cross-shift awareness / handoff
// ---------------------------------------------------------------------------

export const shiftSummary = pgTable("shift_summary", {
  id: uuid("id").primaryKey().defaultRandom(),
  shiftDate: date("shift_date").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }),
  totalActions: integer("total_actions").default(0),
  ordersHandled: integer("orders_handled").default(0),
  ticketsResolved: integer("tickets_resolved").default(0),
  messagesSent: integer("messages_sent").default(0),
  escalations: integer("escalations").default(0),
  issues: jsonb("issues"),
  notes: text("notes"),
  marketSummary: jsonb("market_summary"),
});

export type ShiftSummaryRecord = typeof shiftSummary.$inferInsert;
export type ShiftSummaryRow = typeof shiftSummary.$inferSelect;

// ---------------------------------------------------------------------------
// entity_interactions — "this customer called before" awareness
// ---------------------------------------------------------------------------

export const entityInteractions = pgTable(
  "entity_interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    interactionType: text("interaction_type").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    summary: text("summary"),
    sentiment: text("sentiment"),
    resolved: boolean("resolved").default(false),
    context: jsonb("context"),
  },
  (table) => [
    index("idx_entity_interactions").on(table.entityType, table.entityId, table.timestamp),
  ],
);

export type EntityInteractionRecord = typeof entityInteractions.$inferInsert;
export type EntityInteractionRow = typeof entityInteractions.$inferSelect;

// ---------------------------------------------------------------------------
// shadow_proposals — proposals recorded in shadow mode for human review
// ---------------------------------------------------------------------------

export const shadowProposals = pgTable(
  "shadow_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shiftDate: date("shift_date").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    actionName: text("action_name").notNull(),
    params: jsonb("params"),
    tier: text("tier").notNull(),
    wouldExecuteVia: text("would_execute_via").notNull(),
    reasoning: text("reasoning"),
    agentId: text("agent_id"),
    validationPassed: boolean("validation_passed"),
    validationErrors: jsonb("validation_errors"),
    humanDecision: text("human_decision"),
    humanNote: text("human_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_shadow_proposals_shift").on(table.shiftDate, table.timestamp),
    index("idx_shadow_proposals_action").on(table.actionName, table.timestamp),
    index("idx_shadow_proposals_review").on(table.humanDecision, table.shiftDate),
  ],
);

export type ShadowProposalRecord = typeof shadowProposals.$inferInsert;
export type ShadowProposalRow = typeof shadowProposals.$inferSelect;
