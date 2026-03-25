/**
 * Order-related action definitions.
 *
 * Actions:
 *   - AssignDriverToOrder
 *   - ReassignOrder
 *   - UpdateOrderStatus
 *   - CancelOrder
 *
 * Registered as a side effect of importing this module.
 *
 * @see planning/09-ontology-layer-design.md section 4.1
 */

import { z } from "zod";
import { defineAction } from "../../guardrails/registry.js";
import { Tier } from "../../guardrails/types.js";
import type { OntologyStore } from "../state/store.js";
import { OrderStatus } from "../objects/enums.js";

// ---------------------------------------------------------------------------
// Param schemas
// ---------------------------------------------------------------------------

const AssignDriverToOrderParams = z.object({
  orderId: z.string().describe("UUID of the order to assign"),
  driverId: z.string().describe("Email ID of the driver to assign"),
});

const ReassignOrderParams = z.object({
  orderId: z.string().describe("UUID of the order to reassign"),
  newDriverId: z.string().describe("Email ID of the new driver"),
  reason: z.string().describe("Reason for reassignment"),
});

const UpdateOrderStatusParams = z.object({
  orderId: z.string().describe("UUID of the order"),
  newStatus: OrderStatus.describe("Target order status"),
  reason: z.string().optional().describe("Reason for status change (required for cancellation)"),
});

const CancelOrderParams = z.object({
  orderId: z.string().describe("UUID of the order to cancel"),
  reason: z.string().min(1).describe("Reason for cancellation — must not be empty"),
  cancellationOwner: z.enum(["ValleyEats", "Restaurant", "Driver", "Customer"])
    .describe("Who owns the cancellation decision"),
});

// ---------------------------------------------------------------------------
// Valid forward transitions for the order state machine
// ---------------------------------------------------------------------------

const VALID_FORWARD_TRANSITIONS: Record<string, string[]> = {
  Pending: ["Confirmed"],
  Confirmed: ["Ready", "Pending"], // Pending is a backward exception (restaurant issue)
  Ready: ["EnRoute"],
  EnRoute: ["InTransit"],
  InTransit: ["Completed"],
};

// ---------------------------------------------------------------------------
// AssignDriverToOrder
// ---------------------------------------------------------------------------

defineAction({
  name: "AssignDriverToOrder",
  description: "Assign an available driver to an unassigned order",
  tier: Tier.YELLOW,
  paramsSchema: AssignDriverToOrderParams,
  cooldown: { entity: "order", action: "assign", ttlSeconds: 120 },
  execution: "browser",
  sideEffects: ["notify_driver", "notify_customer_eta", "audit_log"],
  criteria: [
    {
      name: "order_exists",
      check: (params, state) => {
        const store = state as unknown as OntologyStore;
        const order = store.getOrder(params.orderId as string);
        if (!order) return { passed: false, message: "Order not found" };
        return { passed: true };
      },
    },
    {
      name: "order_is_assignable",
      check: (params, state) => {
        const store = state as unknown as OntologyStore;
        const order = store.getOrder(params.orderId as string);
        if (!order) return { passed: false, message: "Order not found" };
        if (["Completed", "Cancelled"].includes(order.status)) {
          return { passed: false, message: `Order is ${order.status} — cannot assign` };
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
    {
      name: "driver_is_available",
      check: (params, state) => {
        const store = state as unknown as OntologyStore;
        const driver = store.getDriver(params.driverId as string);
        if (!driver) return { passed: false, message: "Driver not found" };
        if (!driver.isOnline) {
          return { passed: false, message: `Driver status is ${driver.status} — not online` };
        }
        return { passed: true };
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// ReassignOrder
// ---------------------------------------------------------------------------

defineAction({
  name: "ReassignOrder",
  description: "Reassign an order to a different driver",
  tier: Tier.YELLOW,
  paramsSchema: ReassignOrderParams,
  cooldown: { entity: "order", action: "reassign", ttlSeconds: 600 },
  execution: "browser",
  sideEffects: ["notify_old_driver", "notify_new_driver", "update_customer_eta", "audit_log"],
  criteria: [
    {
      name: "order_has_current_driver",
      check: (params, state) => {
        const store = state as unknown as OntologyStore;
        const order = store.getOrder(params.orderId as string);
        if (!order) return { passed: false, message: "Order not found" };
        if (!order.driverId) {
          return { passed: false, message: "Order has no current driver to reassign from" };
        }
        return { passed: true };
      },
    },
    {
      name: "order_status_allows_reassign",
      check: (params, state) => {
        const store = state as unknown as OntologyStore;
        const order = store.getOrder(params.orderId as string);
        if (!order) return { passed: false, message: "Order not found" };
        if (["InTransit", "Completed", "Cancelled"].includes(order.status)) {
          return {
            passed: false,
            message: `Order is ${order.status} — cannot reassign`,
          };
        }
        return { passed: true };
      },
    },
    {
      name: "new_driver_is_available",
      check: (params, state) => {
        const store = state as unknown as OntologyStore;
        const driver = store.getDriver(params.newDriverId as string);
        if (!driver) return { passed: false, message: "New driver not found" };
        if (!driver.isOnline) {
          return { passed: false, message: `New driver status is ${driver.status} — not online` };
        }
        return { passed: true };
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// UpdateOrderStatus
// ---------------------------------------------------------------------------

defineAction({
  name: "UpdateOrderStatus",
  description: "Change the status of an order (forward transitions GREEN, cancellation ORANGE)",
  tier: Tier.GREEN, // Baseline tier; cancellation path should be evaluated at runtime
  paramsSchema: UpdateOrderStatusParams,
  cooldown: { entity: "order", action: "status", ttlSeconds: 120 },
  execution: "browser",
  sideEffects: ["notify_parties", "update_tracking", "audit_log"],
  criteria: [
    {
      name: "valid_status_transition",
      check: (params, state) => {
        const store = state as unknown as OntologyStore;
        const order = store.getOrder(params.orderId as string);
        if (!order) return { passed: false, message: "Order not found" };

        const newStatus = params.newStatus as string;

        // Cancellation is always a valid transition (except from Completed/Cancelled)
        if (newStatus === "Cancelled") {
          if (order.status === "Completed") {
            return { passed: false, message: "Cannot cancel a completed order" };
          }
          if (order.status === "Cancelled") {
            return { passed: false, message: "Order is already cancelled" };
          }
          return { passed: true };
        }

        // Check forward (or allowed backward) transitions
        const allowed = VALID_FORWARD_TRANSITIONS[order.status];
        if (!allowed || !allowed.includes(newStatus)) {
          return {
            passed: false,
            message: `Invalid transition: ${order.status} → ${newStatus}`,
          };
        }
        return { passed: true };
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// CancelOrder
// ---------------------------------------------------------------------------

defineAction({
  name: "CancelOrder",
  description: "Cancel an active order — requires human approval (RED tier)",
  tier: Tier.RED,
  paramsSchema: CancelOrderParams,
  execution: "browser",
  sideEffects: [
    "notify_customer",
    "notify_driver",
    "notify_restaurant",
    "trigger_refund_evaluation",
    "audit_log",
  ],
  criteria: [
    {
      name: "order_not_already_terminal",
      check: (params, state) => {
        const store = state as unknown as OntologyStore;
        const order = store.getOrder(params.orderId as string);
        if (!order) return { passed: false, message: "Order not found" };
        if (order.status === "Completed") {
          return { passed: false, message: "Order is already completed — cannot cancel" };
        }
        if (order.status === "Cancelled") {
          return { passed: false, message: "Order is already cancelled" };
        }
        return { passed: true };
      },
    },
    {
      name: "reason_not_empty",
      check: (params) => {
        const reason = params.reason as string;
        if (!reason || reason.trim().length === 0) {
          return { passed: false, message: "Cancellation reason must not be empty" };
        }
        return { passed: true };
      },
    },
  ],
});
