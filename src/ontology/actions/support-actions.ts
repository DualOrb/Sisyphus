/**
 * Support / ticket action definitions.
 *
 * Actions:
 *   - ResolveTicket
 *   - EscalateTicket
 *   - AddTicketNote
 *   - UpdateTicketOwner
 *
 * Registered as a side effect of importing this module.
 *
 * @see planning/09-ontology-layer-design.md section 4.3
 */

import { z } from "zod";
import { defineAction } from "../../guardrails/registry.js";
import { Tier } from "../../guardrails/types.js";
import type { OntologyStore } from "../state/store.js";
import { Severity } from "../objects/enums.js";

// ---------------------------------------------------------------------------
// Issue statuses that allow modifications.
// DynamoDB uses "New" and "Pending" (not "Open" / "InProgress").
// ---------------------------------------------------------------------------

const MODIFIABLE_STATUSES = ["New", "Pending"];

// ---------------------------------------------------------------------------
// Param schemas
// ---------------------------------------------------------------------------

const ResolveTicketParams = z.object({
  ticketId: z.string().describe("8-char hash ID of the ticket"),
  resolution: z.string().describe("Resolution summary"),
  resolutionType: z.enum(["refund", "credit", "redelivery", "apology", "no_action"])
    .describe("Type of resolution applied"),
  /** Refund amount in cents — required when resolutionType is 'refund' */
  refundAmount: z.number().int().min(0).optional()
    .describe("Refund amount in cents (required for refund resolution)"),
});

const EscalateTicketParams = z.object({
  ticketId: z.string().describe("8-char hash ID of the ticket"),
  reason: z.string().describe("Reason for escalation"),
  severity: Severity.describe("Escalation severity level"),
});

const AddTicketNoteParams = z.object({
  ticketId: z.string().describe("8-char hash ID of the ticket"),
  note: z.string().describe("Note content to add"),
});

const UpdateTicketOwnerParams = z.object({
  ticketId: z.string().describe("8-char hash ID of the ticket"),
  newOwner: z.string().describe("Email or name of the new owner"),
});

// ---------------------------------------------------------------------------
// ResolveTicket
// ---------------------------------------------------------------------------

defineAction({
  name: "ResolveTicket",
  description: "Resolve a support ticket with a resolution (ORANGE if refund, YELLOW otherwise)",
  tier: Tier.ORANGE, // Baseline tier; non-refund resolutions could be treated as YELLOW at runtime
  paramsSchema: ResolveTicketParams,
  cooldown: { entity: "ticket", action: "resolve", ttlSeconds: 300 },
  execution: "api",
  sideEffects: ["notify_customer", "trigger_refund", "audit_log"],
  criteria: [
    {
      name: "ticket_status_is_modifiable",
      check: (params, state) => {
        const store = state as unknown as OntologyStore;
        const ticket = store.getTicket(params.ticketId as string);
        if (!ticket) return { passed: false, message: "Ticket not found" };
        if (!MODIFIABLE_STATUSES.includes(ticket.status)) {
          return {
            passed: false,
            message: `Ticket status is ${ticket.status} — must be New or Pending`,
          };
        }
        return { passed: true };
      },
    },
    {
      name: "refund_amount_required_for_refund",
      check: (params) => {
        const resolutionType = params.resolutionType as string;
        const refundAmount = params.refundAmount as number | undefined;
        if (resolutionType === "refund" && (refundAmount === undefined || refundAmount === null)) {
          return { passed: false, message: "Refund amount is required when resolution type is refund" };
        }
        return { passed: true };
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// EscalateTicket
// ---------------------------------------------------------------------------

defineAction({
  name: "EscalateTicket",
  description: "Escalate a ticket to human dispatch — always safe (GREEN tier)",
  tier: Tier.GREEN,
  paramsSchema: EscalateTicketParams,
  execution: "api",
  sideEffects: ["alert_dispatchers", "audit_log"],
  criteria: [
    {
      name: "ticket_status_is_modifiable",
      check: (params, state) => {
        const store = state as unknown as OntologyStore;
        const ticket = store.getTicket(params.ticketId as string);
        if (!ticket) return { passed: false, message: "Ticket not found" };
        if (!MODIFIABLE_STATUSES.includes(ticket.status)) {
          return {
            passed: false,
            message: `Ticket status is ${ticket.status} — must be New or Pending`,
          };
        }
        return { passed: true };
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// AddTicketNote
// ---------------------------------------------------------------------------

defineAction({
  name: "AddTicketNote",
  description: "Add an investigation note to a ticket",
  tier: Tier.GREEN,
  paramsSchema: AddTicketNoteParams,
  execution: "api",
  sideEffects: ["audit_log"],
  criteria: [
    {
      name: "ticket_status_is_modifiable",
      check: (params, state) => {
        const store = state as unknown as OntologyStore;
        const ticket = store.getTicket(params.ticketId as string);
        if (!ticket) return { passed: false, message: "Ticket not found" };
        if (!MODIFIABLE_STATUSES.includes(ticket.status)) {
          return {
            passed: false,
            message: `Ticket status is ${ticket.status} — must be New or Pending`,
          };
        }
        return { passed: true };
      },
    },
    {
      name: "note_not_empty",
      check: (params) => {
        const note = params.note as string;
        if (!note || note.trim().length === 0) {
          return { passed: false, message: "Note must not be empty" };
        }
        return { passed: true };
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// UpdateTicketOwner
// ---------------------------------------------------------------------------

defineAction({
  name: "UpdateTicketOwner",
  description: "Change the assigned owner of a ticket",
  tier: Tier.YELLOW,
  paramsSchema: UpdateTicketOwnerParams,
  execution: "api",
  sideEffects: ["audit_log"],
  criteria: [
    {
      name: "ticket_status_is_modifiable",
      check: (params, state) => {
        const store = state as unknown as OntologyStore;
        const ticket = store.getTicket(params.ticketId as string);
        if (!ticket) return { passed: false, message: "Ticket not found" };
        if (!MODIFIABLE_STATUSES.includes(ticket.status)) {
          return {
            passed: false,
            message: `Ticket status is ${ticket.status} — must be New or Pending`,
          };
        }
        return { passed: true };
      },
    },
  ],
});
