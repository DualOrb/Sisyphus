/**
 * Conversation & Message schemas — maps to:
 *   - ValleyEats-DriverMessages (individual chat messages)
 *   - ValleyEats-DriverLatestMessage (latest message cache per driver)
 *
 * Key conventions:
 * - DriverId (email) is the PK for both tables.
 * - Timestamps (ts) are Unix epoch seconds.
 * - Message direction is determined by the Colour field:
 *     Colour === "Undefined" → message FROM the driver
 *     Any other colour value → message TO the driver (from dispatch staff)
 * - Author is a human-readable name, not an email or ID.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Message — individual chat message from ValleyEats-DriverMessages
// ---------------------------------------------------------------------------

export const MessageSchema = z.object({
  /** Driver email — partition key */
  driverId: z.string().email().describe("DynamoDB PK: DriverMessages.DriverId"),
  /** Message timestamp — Unix epoch seconds (also the sort key) */
  timestamp: z.coerce.date().describe("DynamoDB SK: DriverMessages.ts"),
  /** Message text content */
  content: z.string().describe("DynamoDB: DriverMessages.Message"),
  /** Human-readable name of the message author */
  author: z.string().describe("DynamoDB: DriverMessages.Author"),
  /**
   * Chat UI colour of the author.
   * "Undefined" means the message was sent BY the driver.
   * Any other value (e.g. "#b896b7") means it was sent TO the driver.
   */
  colour: z.string().describe("DynamoDB: DriverMessages.Colour"),
  /**
   * Computed direction flag.
   * true = message was sent BY the driver (Colour === "Undefined").
   * false = message was sent TO the driver by dispatch/support staff.
   */
  isFromDriver: z.boolean().describe('Computed: Colour === "Undefined"'),
});
export type Message = z.infer<typeof MessageSchema>;

// ---------------------------------------------------------------------------
// Conversation — latest-message cache from ValleyEats-DriverLatestMessage
// ---------------------------------------------------------------------------

export const ConversationSchema = z.object({
  /** Driver email — primary key (one conversation per driver) */
  driverId: z.string().email().describe("DynamoDB PK: DriverLatestMessage.DriverId"),
  /** When the last message was sent/received — Unix epoch seconds */
  lastMessageAt: z.coerce.date().describe("DynamoDB: DriverLatestMessage.ts"),
  /** Preview text of the most recent message */
  lastMessagePreview: z.string().describe("DynamoDB: DriverLatestMessage.Message"),
  /** Human-readable name of the last message author */
  lastAuthor: z.string().describe("DynamoDB: DriverLatestMessage.Author"),
  /** Chat colour of the last author ("Undefined" = from driver) */
  lastColour: z.string().describe("DynamoDB: DriverLatestMessage.Colour"),
  /** When the conversation was last opened/viewed — Unix epoch seconds (nullable) */
  lastOpenedAt: z.coerce.date().nullable().optional()
    .describe("DynamoDB: DriverLatestMessage.Opened"),

  // ---- Computed properties (populated during ontology sync) ----
  /** Whether the last message was from the driver (needs a reply) */
  lastMessageFromDriver: z.boolean()
    .describe('Computed: lastColour === "Undefined"'),
  /**
   * Whether there are unread messages (driver sent something after
   * the conversation was last opened).
   */
  hasUnread: z.boolean().describe("Computed: lastMessageAt > lastOpenedAt"),
});
export type Conversation = z.infer<typeof ConversationSchema>;
