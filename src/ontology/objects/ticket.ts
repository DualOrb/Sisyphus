/**
 * Ticket (Issue) schema — maps to ValleyEats-IssueTracker DynamoDB table.
 *
 * Key conventions:
 * - IssueId is an 8-character hash string (e.g. "b04b887b"), NOT a UUID.
 * - Created timestamp is Unix epoch seconds.
 * - Originator can be a customer email or "Supervisor" (system-generated).
 * - Owner is "Unassigned" or an agent email.
 * - Actions, Messages, and Notes are embedded arrays.
 */

import { z } from "zod";
import { IssueStatus, IssueCategory } from "./enums.js";

// ---------------------------------------------------------------------------
// TicketAction — embedded status change / assignment history
// ---------------------------------------------------------------------------

export const TicketActionSchema = z.object({
  /** When the action occurred — Unix epoch seconds */
  timestamp: z.coerce.date().describe("DynamoDB: Actions[].Timestamp"),
  /** Who performed the action (human-readable name) */
  actor: z.string().describe("DynamoDB: Actions[].Actor"),
  /** Description of what happened */
  description: z.string().describe("DynamoDB: Actions[].Description"),
});
export type TicketAction = z.infer<typeof TicketActionSchema>;

// ---------------------------------------------------------------------------
// TicketMessage — customer ↔ support chat message
// ---------------------------------------------------------------------------

export const TicketMessageSchema = z.object({
  /** Message text content */
  message: z.string().describe("DynamoDB: Messages[].Message"),
  /** Who sent the message (email address) */
  originator: z.string().describe("DynamoDB: Messages[].Originator"),
  /** When the message was sent — Unix epoch seconds */
  sent: z.coerce.date().describe("DynamoDB: Messages[].Send"),
  /** When the message was read — Unix epoch seconds (optional) */
  read: z.coerce.date().nullable().optional().describe("DynamoDB: Messages[].Read"),
});
export type TicketMessage = z.infer<typeof TicketMessageSchema>;

// ---------------------------------------------------------------------------
// TicketNote — internal dispatch / support notes
// ---------------------------------------------------------------------------

export const TicketNoteSchema = z.object({
  /** Who wrote the note (human-readable name) */
  author: z.string().describe("DynamoDB: Notes[].Author"),
  /** When the note was written — Unix epoch seconds */
  timestamp: z.coerce.date().describe("DynamoDB: Notes[].Timestamp"),
  /** Note content */
  note: z.string().describe("DynamoDB: Notes[].Note"),
});
export type TicketNote = z.infer<typeof TicketNoteSchema>;

// ---------------------------------------------------------------------------
// Ticket
// ---------------------------------------------------------------------------

export const TicketSchema = z.object({
  // ---- Identity ----
  /** 8-character hash string primary key */
  issueId: z.string().describe("DynamoDB PK: IssueId — 8-char hash"),
  /** Category of the issue */
  category: IssueCategory.describe("DynamoDB: Category"),
  /** Specific issue type (free-form string) */
  issueType: z.string().describe("DynamoDB: IssueType"),
  /** Current status */
  status: IssueStatus.describe("DynamoDB: IssueStatus"),

  // ---- Timing ----
  /** When the issue was created — Unix epoch seconds */
  createdAt: z.coerce.date().describe("DynamoDB: Created"),

  // ---- Linked entities ----
  /** Linked order UUID (null for non-order issues) */
  orderId: z.string().nullable().optional().describe("DynamoDB: OrderId — UUID"),
  /** Short order ID (first 8 chars of UUID) */
  orderIdKey: z.string().nullable().optional().describe("DynamoDB: OrderIdKey"),
  /** Linked restaurant UUID */
  restaurantId: z.string().nullable().optional().describe("DynamoDB: RestaurantId"),
  /** Denormalized restaurant name */
  restaurantName: z.string().nullable().optional().describe("DynamoDB: RestaurantName"),
  /** Linked driver email */
  driverId: z.string().nullable().optional().describe("DynamoDB: DriverId — email"),
  /** Market / zone */
  market: z.string().optional().describe("DynamoDB: Market"),

  // ---- People ----
  /** Who filed the issue: customer email or "Supervisor" for system-generated */
  originator: z.string().describe("DynamoDB: Originator"),
  /** Assigned agent: email or "Unassigned" */
  owner: z.string().describe("DynamoDB: Owner"),

  // ---- Content ----
  /** Description of the issue */
  description: z.string().describe("DynamoDB: Description"),
  /** Resolution summary (null if unresolved) */
  resolution: z.string().nullable().optional().describe("DynamoDB: Resolution"),

  // ---- Embedded history ----
  /** Status change and assignment history */
  actions: z.array(TicketActionSchema).optional().describe("DynamoDB: Actions"),
  /** Customer ↔ support conversation */
  messages: z.array(TicketMessageSchema).optional().describe("DynamoDB: Messages"),
  /** Internal dispatch / support notes */
  notes: z.array(TicketNoteSchema).optional().describe("DynamoDB: Notes"),
});

export type Ticket = z.infer<typeof TicketSchema>;
