/**
 * Shared types for the Sisyphus dashboard API.
 *
 * Re-exports the subset of ontology types the dashboard needs.
 * The Vite frontend references these via a tsconfig path alias.
 */

// Ontology entities
export type { Order } from "../ontology/objects/order.js";
export type { Driver } from "../ontology/objects/driver.js";
export type { Restaurant } from "../ontology/objects/restaurant.js";
export type { Customer } from "../ontology/objects/customer.js";
export type { Ticket } from "../ontology/objects/ticket.js";
export type { Market } from "../ontology/objects/market.js";
export type { Conversation, Message } from "../ontology/objects/conversation.js";

// Enums
export {
  OrderStatus,
  DriverStatus,
  IssueStatus,
  DemandLevel,
} from "../ontology/objects/enums.js";

// State
export type { OntologyStats } from "../ontology/state/store.js";

// Events
export type {
  DispatchEvent,
  PrioritizedEvent,
  EventPriority,
} from "../events/types.js";

// Shift
export type { ShiftStats } from "../shift/activities.js";

// Health
export type {
  SystemHealth,
  HealthStatus,
  ComponentHealth,
} from "../health/checks.js";

// Guardrails / audit
export type { AuditRecord, ActionOutcome, Tier } from "../guardrails/types.js";

// DB rows
export type { AuditLogRow } from "../../db/schema.js";

// ---------------------------------------------------------------------------
// Dashboard-specific response types
// ---------------------------------------------------------------------------

export interface OverviewData {
  stats: import("../ontology/state/store.js").OntologyStats;
  health: import("../health/checks.js").SystemHealth;
  shift?: import("../shift/activities.js").ShiftStats;
  eventQueueSize: number;
  uptime: number;
}
