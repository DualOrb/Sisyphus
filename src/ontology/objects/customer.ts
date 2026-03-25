/**
 * Customer (User) schema — maps to ValleyEats-Users DynamoDB table.
 *
 * Key conventions:
 * - PK is the customer's EMAIL address, not a UUID.
 * - CustomerId is the Stripe customer ID (cus_...).
 * - In-app Messages are embedded directly in the user record.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// DeliveryAddress — saved customer address with lat/lng
// ---------------------------------------------------------------------------

export const DeliveryAddressSchema = z.object({
  deliveryStreet: z.string().describe("DynamoDB: DeliveryStreet"),
  deliveryCity: z.string().describe("DynamoDB: DeliveryCity"),
  deliveryProvince: z.string().describe("DynamoDB: DeliveryProvince"),
  deliveryCountry: z.string().optional().describe("DynamoDB: DeliveryCountry"),
  deliveryPostal: z.string().optional().describe("DynamoDB: DeliveryPostal"),
  deliveryLat: z.number().optional().describe("DynamoDB: DeliveryLat"),
  deliveryLng: z.number().optional().describe("DynamoDB: DeliveryLng"),
  deliveryAptNo: z.string().nullable().optional().describe("DynamoDB: DeliveryAptNo"),
  deliveryInstructions: z.string().nullable().optional().describe("DynamoDB: DeliveryInstructions"),
  deliveryType: z.string().optional().describe("DynamoDB: DeliveryType"),
});
export type DeliveryAddress = z.infer<typeof DeliveryAddressSchema>;

// ---------------------------------------------------------------------------
// InAppMessage — support message embedded in the user record
// ---------------------------------------------------------------------------

export const InAppMessageSchema = z.object({
  /** Message text content */
  message: z.string().describe("DynamoDB: Messages[].message"),
  /** When the message was sent — Unix epoch seconds */
  sent: z.coerce.date().describe("DynamoDB: Messages[].sent"),
  /** Whether the customer has read this message */
  isRead: z.boolean().describe("DynamoDB: Messages[].isread"),
  /** Optional link to a support issue */
  issueId: z.string().nullable().optional().describe("DynamoDB: Messages[].IssueId — 8-char hash"),
});
export type InAppMessage = z.infer<typeof InAppMessageSchema>;

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

export const CustomerSchema = z.object({
  // ---- Identity ----
  /** Email address — primary key in DynamoDB */
  email: z.string().email().describe("DynamoDB PK: Email"),
  /** Human-readable full name */
  name: z.string().describe("DynamoDB: FullName"),
  /** Phone number */
  phone: z.string().describe("DynamoDB: Phone"),
  /** Stripe customer ID (cus_...) */
  stripeCustomerId: z.string().optional().describe("DynamoDB: CustomerId — Stripe ID"),

  // ---- Account creation ----
  /** When the account was created — Unix epoch seconds */
  createdAt: z.coerce.date().optional().describe("DynamoDB: Created"),

  // ---- Delivery addresses ----
  deliveryAddresses: z.array(DeliveryAddressSchema).describe("DynamoDB: DeliveryAddresses"),

  // ---- Loyalty ----
  /** Current perks/loyalty point balance */
  perksPoints: z.number().int().describe("DynamoDB: PerksPoints"),

  // ---- In-app messaging ----
  /** Embedded support messages */
  messages: z.array(InAppMessageSchema).optional().describe("DynamoDB: Messages"),

  // ---- Device info ----
  appVersion: z.string().optional().describe("DynamoDB: AppVersion"),

  // ---- Computed properties (populated during ontology sync) ----
  /** Total number of orders placed by this customer */
  totalOrders: z.number().int().optional().describe("Computed: count from Orders table"),
});

export type Customer = z.infer<typeof CustomerSchema>;
