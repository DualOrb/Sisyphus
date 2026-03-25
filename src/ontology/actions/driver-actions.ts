/**
 * Driver communication action definitions.
 *
 * Actions:
 *   - SendDriverMessage
 *   - FollowUpWithDriver
 *
 * Registered as a side effect of importing this module.
 *
 * @see planning/09-ontology-layer-design.md section 4.2
 */

import { z } from "zod";
import { defineAction } from "../../guardrails/registry.js";
import { Tier } from "../../guardrails/types.js";
import type { OntologyStore } from "../state/store.js";

// ---------------------------------------------------------------------------
// Param schemas
// ---------------------------------------------------------------------------

const SendDriverMessageParams = z.object({
  driverId: z.string().describe("Email ID of the driver to message"),
  message: z.string().describe("Message content to send"),
  relatedOrderId: z.string().optional().describe("UUID of the related order, if any"),
});

const FollowUpWithDriverParams = z.object({
  driverId: z.string().describe("Email ID of the driver"),
  originalContext: z.string().describe("Context of the original message / situation"),
  followUpMessage: z.string().describe("Follow-up message content"),
});

// ---------------------------------------------------------------------------
// SendDriverMessage
// ---------------------------------------------------------------------------

defineAction({
  name: "SendDriverMessage",
  description: "Send a message to a driver in their conversation",
  tier: Tier.YELLOW,
  paramsSchema: SendDriverMessageParams,
  cooldown: { entity: "driver", action: "message", ttlSeconds: 300 },
  execution: "browser",
  sideEffects: ["deliver_message", "audit_log"],
  criteria: [
    {
      name: "message_length_valid",
      check: (params) => {
        const message = params.message as string;
        if (!message || message.length === 0) {
          return { passed: false, message: "Message must not be empty" };
        }
        if (message.length >= 500) {
          return { passed: false, message: `Message is ${message.length} chars — must be under 500` };
        }
        return { passed: true };
      },
    },
    {
      name: "driver_exists",
      check: (params, state) => {
        const store = state as unknown as OntologyStore;
        const driver = store.getDriver(params.driverId as string);
        if (!driver) return { passed: false, message: "Driver not found" };
        return { passed: true };
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// FollowUpWithDriver
// ---------------------------------------------------------------------------

defineAction({
  name: "FollowUpWithDriver",
  description: "Send a follow-up message when a driver has not responded",
  tier: Tier.YELLOW,
  paramsSchema: FollowUpWithDriverParams,
  cooldown: { entity: "driver", action: "followup", ttlSeconds: 600 },
  rateLimit: { maxPerHour: 3, scope: "per_entity" },
  execution: "browser",
  sideEffects: ["deliver_message", "flag_if_third_followup", "audit_log"],
  criteria: [
    {
      name: "follow_up_message_not_empty",
      check: (params) => {
        const msg = params.followUpMessage as string;
        if (!msg || msg.trim().length === 0) {
          return { passed: false, message: "Follow-up message must not be empty" };
        }
        return { passed: true };
      },
    },
  ],
});
