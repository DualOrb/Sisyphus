/**
 * LangGraph agent tools for interacting with the Sisyphus ontology.
 *
 * These are the ONLY way agents interact with the world. Each tool is a
 * DynamicStructuredTool with a Zod schema describing its parameters and a
 * func that performs the operation against the OntologyStore or Redis.
 *
 * Usage:
 *   const tools = createOntologyTools(store, redis);
 *   // Pass `tools` to a LangGraph agent or supervisor
 *
 * @see planning/09-ontology-layer-design.md section 7
 * @see planning/03-agent-design.md section 5
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { Redis as RedisClient } from "ioredis";
import type { OntologyStore } from "../ontology/state/index.js";
import { executeAction } from "../guardrails/index.js";
import type { ExecutionContext } from "../guardrails/index.js";
import { createChildLogger } from "../lib/index.js";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const log = createChildLogger("ontology-tools");

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Create the full set of ontology tools, closing over a shared OntologyStore
 * and Redis client. Returns an array of DynamicStructuredTool instances ready
 * for use in a LangGraph agent.
 *
 * @param store  The in-memory ontology state store (populated by sync layer).
 * @param redis  Redis client for cooldowns, timelines, and action execution.
 * @param agentId  Default agent identifier used for audit trail attribution.
 * @param dynamoClient  Optional DynamoDB client for direct table queries (e.g. DriverShifts).
 */
export function createOntologyTools(
  store: OntologyStore,
  redis: RedisClient,
  agentId = "sisyphus",
  dynamoClient?: DynamoDBClient,
): DynamicStructuredTool[] {
  // ------------------------------------------------------------------
  // 1. query_orders — Query orders with optional filters
  // ------------------------------------------------------------------

  const queryOrdersTool = new DynamicStructuredTool({
    name: "query_orders",
    description:
      "Query orders from the ontology with optional filters. Returns an array of order summaries " +
      "including orderId, orderIdKey, status, restaurantName, driverId, deliveryZone, placedAt, and isLate. " +
      "Use this to find orders matching specific criteria (e.g., all late orders in a zone, " +
      "all orders assigned to a specific driver).",
    schema: z.object({
      status: z
        .string()
        .nullable().optional()
        .describe(
          "Filter by order status (e.g. Pending, Confirmed, Ready, EnRoute, InTransit, Completed, Cancelled)",
        ),
      deliveryZone: z
        .string()
        .nullable().optional()
        .describe("Filter by delivery zone / market name"),
      driverId: z
        .string()
        .nullable().optional()
        .describe("Filter by assigned driver ID (email address)"),
    }),
    func: async (input) => {
      try {
        const orders = store.queryOrders({
          status: input.status ?? undefined,
          deliveryZone: input.deliveryZone ?? undefined,
          driverId: input.driverId ?? undefined,
        });

        const summaries = orders.map((o) => ({
          orderId: o.orderId,
          orderIdKey: o.orderIdKey,
          status: o.status,
          restaurantName: o.restaurantName,
          driverId: o.driverId,
          deliveryZone: o.deliveryZone,
          placedAt: o.placedAt.toISOString(),
          isLate: o.isLate,
          waitTimeMinutes: o.waitTimeMinutes,
        }));

        return JSON.stringify({ count: summaries.length, orders: summaries });
      } catch (err) {
        log.error({ err, input }, "query_orders failed");
        return JSON.stringify({
          error: "Failed to query orders",
          details: String(err),
        });
      }
    },
  });

  // ------------------------------------------------------------------
  // 2. query_drivers — Query drivers with optional filters
  // ------------------------------------------------------------------

  const queryDriversTool = new DynamicStructuredTool({
    name: "query_drivers",
    description:
      "Query drivers from the ontology with optional filters. Returns an array of driver summaries " +
      "including driverId, name, dispatchZone, isAvailable, isPaused, isOnline, and activeOrdersCount. " +
      "Use this to find available drivers in a zone, check driver capacity, etc.",
    schema: z.object({
      dispatchZone: z
        .string()
        .nullable().optional()
        .describe("Filter by dispatch zone name"),
      isAvailable: z
        .boolean()
        .nullable().optional()
        .describe("Filter by availability flag (true = accepting orders)"),
    }),
    func: async (input) => {
      try {
        const drivers = store.queryDrivers({
          dispatchZone: input.dispatchZone ?? undefined,
          isAvailable: input.isAvailable ?? undefined,
        });

        const summaries = drivers.map((d) => ({
          driverId: d.driverId,
          name: d.name,
          monacher: d.monacher ?? null,
          dispatchZone: d.dispatchZone,
          isAvailable: d.isAvailable,
          isPaused: d.isPaused,
          isOnline: d.isOnline,
          status: d.status,
          activeOrdersCount: d.activeOrdersCount,
        }));

        return JSON.stringify({
          count: summaries.length,
          drivers: summaries,
        });
      } catch (err) {
        log.error({ err, input }, "query_drivers failed");
        return JSON.stringify({
          error: "Failed to query drivers",
          details: String(err),
        });
      }
    },
  });

  // ------------------------------------------------------------------
  // 3. query_tickets — Query tickets with optional filters
  // ------------------------------------------------------------------

  const queryTicketsTool = new DynamicStructuredTool({
    name: "query_tickets",
    description:
      "Query support tickets from the ontology with optional filters. Returns an array of ticket summaries " +
      "including issueId, status, category, issueType, market, owner, originator, orderId, and createdAt. " +
      "Use this to find open tickets, tickets in a specific market, or tickets assigned to a specific owner.",
    schema: z.object({
      status: z
        .string()
        .nullable().optional()
        .describe("Filter by ticket status (e.g. New, Pending, Resolved, Closed)"),
      market: z.string().nullable().optional().describe("Filter by market / zone name"),
      owner: z
        .string()
        .nullable().optional()
        .describe('Filter by assigned owner (email or "Unassigned")'),
    }),
    func: async (input) => {
      try {
        const tickets = store.queryTickets({
          status: input.status ?? undefined,
          market: input.market ?? undefined,
          owner: input.owner ?? undefined,
        });

        const summaries = tickets.map((t) => ({
          issueId: t.issueId,
          status: t.status,
          category: t.category,
          issueType: t.issueType,
          market: t.market,
          owner: t.owner,
          originator: t.originator,
          orderId: t.orderId,
          orderIdKey: t.orderIdKey,
          description: t.description,
          createdAt: t.createdAt.toISOString(),
        }));

        return JSON.stringify({
          count: summaries.length,
          tickets: summaries,
        });
      } catch (err) {
        log.error({ err, input }, "query_tickets failed");
        return JSON.stringify({
          error: "Failed to query tickets",
          details: String(err),
        });
      }
    },
  });

  // ------------------------------------------------------------------
  // 4. get_order_details — Full order with linked entities
  // ------------------------------------------------------------------

  const getOrderDetailsTool = new DynamicStructuredTool({
    name: "get_order_details",
    description:
      "Get full details for a specific order including linked entities: customer name, driver name, " +
      "restaurant info, and related support tickets. Use this when you need complete context about " +
      "an order before making a decision. Accepts either the full OrderId UUID or the 8-character OrderIdKey.",
    schema: z.object({
      orderId: z
        .string()
        .describe("The order ID to look up — either the full UUID (e.g. '19c2d965-0828-4d67-af20-3c193b12f23f') or the 8-char short key (e.g. '19c2d965')"),
    }),
    func: async (input) => {
      try {
        const order = store.getOrder(input.orderId);
        if (!order) {
          return JSON.stringify({
            error: "Order not found",
            orderId: input.orderId,
          });
        }

        // Resolve linked entities
        const customer = order.customerId
          ? store.getCustomer(order.customerId)
          : undefined;
        const driver = order.driverId
          ? store.getDriver(order.driverId)
          : undefined;
        const restaurant = order.restaurantId
          ? store.getRestaurant(order.restaurantId)
          : undefined;

        // Find related tickets
        const relatedTickets = store
          .queryTickets({})
          .filter((t) => t.orderId === order.orderId)
          .map((t) => ({
            issueId: t.issueId,
            status: t.status,
            category: t.category,
            issueType: t.issueType,
            owner: t.owner,
            description: t.description,
          }));

        const result = {
          order: {
            orderId: order.orderId,
            orderIdKey: order.orderIdKey,
            status: order.status,
            orderType: order.orderType,
            deliveryType: order.deliveryType,
            isAsap: order.isAsap,
            deliveryZone: order.deliveryZone,
            deliveryStreet: order.deliveryStreet,
            deliveryCity: order.deliveryCity,
            deliveryInstructions: order.deliveryInstructions,
            placedAt: order.placedAt.toISOString(),
            readyAt: order.readyAt?.toISOString() ?? null,
            deliveredAt: order.deliveredAt?.toISOString() ?? null,
            isLate: order.isLate,
            waitTimeMinutes: order.waitTimeMinutes,
            timeSinceReady: order.timeSinceReady,
            hasAlcohol: order.hasAlcohol,
            itemCount: order.items.length,
            items: order.items.map((i) => ({
              name: i.itemName,
              quantity: i.quantity,
            })),
            totalCents: order.total,
          },
          customer: customer
            ? {
                name: customer.name,
                email: customer.email,
                phone: customer.phone,
                totalOrders: customer.totalOrders,
              }
            : null,
          driver: driver
            ? {
                driverId: driver.driverId,
                name: driver.name,
                phone: driver.phone,
                dispatchZone: driver.dispatchZone,
                isOnline: driver.isOnline,
                activeOrdersCount: driver.activeOrdersCount,
              }
            : null,
          restaurant: restaurant
            ? {
                restaurantId: restaurant.restaurantId,
                name: restaurant.name,
                phone: restaurant.phone,
                isOpen: restaurant.isOpen,
                isTabletOnline: restaurant.isTabletOnline,
                currentLoad: restaurant.currentLoad,
              }
            : null,
          relatedTickets,
        };

        return JSON.stringify(result);
      } catch (err) {
        log.error({ err, input }, "get_order_details failed");
        return JSON.stringify({
          error: "Failed to get order details",
          details: String(err),
        });
      }
    },
  });

  // ------------------------------------------------------------------
  // 5. get_entity_timeline — Recent actions for an entity
  // ------------------------------------------------------------------

  const getEntityTimelineTool = new DynamicStructuredTool({
    name: "get_entity_timeline",
    description:
      "Get the recent action timeline for an entity. Returns a chronological list of actions " +
      "that have been taken on or related to this entity within the specified time window. " +
      "Use this to understand what has already happened before deciding on next steps. " +
      "Entity types: order, driver, ticket, restaurant, customer.",
    schema: z.object({
      entityType: z
        .enum(["order", "driver", "ticket", "restaurant", "customer"])
        .describe("The type of entity to get the timeline for"),
      entityId: z
        .string()
        .describe(
          "The entity ID (orderId UUID, driverId email, issueId, restaurantId, or customer email)",
        ),
      hours: z
        .number()
        .nullable().optional()
        .default(2)
        .describe(
          "How many hours of history to retrieve (default: 2)",
        ),
    }),
    func: async (input) => {
      try {
        const key = `timeline:${input.entityType}:${input.entityId}`;
        const hours = input.hours ?? 24;
        const cutoff = Date.now() - hours * 60 * 60 * 1000;
        const cutoffScore = cutoff.toString();

        // Retrieve timeline entries from a Redis sorted set
        // Entries are stored as JSON strings scored by timestamp
        const rawEntries = await redis.zrangebyscore(
          key,
          cutoffScore,
          "+inf",
          "WITHSCORES",
        );

        // Parse results: alternating [value, score, value, score, ...]
        const events: Array<{
          timestamp: string;
          data: Record<string, unknown>;
        }> = [];

        for (let i = 0; i < rawEntries.length; i += 2) {
          const value = rawEntries[i];
          const score = rawEntries[i + 1];
          try {
            const data = JSON.parse(value) as Record<string, unknown>;
            events.push({
              timestamp: new Date(Number(score)).toISOString(),
              data,
            });
          } catch {
            // Skip unparseable entries
            log.warn(
              { key, value },
              "Skipping unparseable timeline entry",
            );
          }
        }

        return JSON.stringify({
          entityType: input.entityType,
          entityId: input.entityId,
          hours: input.hours,
          count: events.length,
          events,
        });
      } catch (err) {
        log.error({ err, input }, "get_entity_timeline failed");
        return JSON.stringify({
          error: "Failed to get entity timeline",
          details: String(err),
        });
      }
    },
  });

  // ------------------------------------------------------------------
  // 6. execute_action — The main action tool
  // ------------------------------------------------------------------

  const executeActionTool = new DynamicStructuredTool({
    name: "execute_action",
    description:
      "Execute a named action through the ontology guardrails pipeline. The action will be " +
      "validated against submission criteria, checked for cooldowns and rate limits, and " +
      "executed according to its autonomy tier (GREEN/YELLOW auto-execute, ORANGE staged " +
      "for review, RED requires human approval). ALWAYS provide a clear reasoning string " +
      "explaining why you chose this action — it is logged to the audit trail.\n\n" +
      "Available actions include: AssignDriverToOrder, ReassignOrder, UpdateOrderStatus, " +
      "CancelOrder, SendDriverMessage, FollowUpWithDriver, ResolveTicket, EscalateTicket, " +
      "AddTicketNote, FlagMarketIssue, and more.",
    schema: z.object({
      actionName: z
        .string()
        .describe(
          "The registered action name (e.g. 'SendDriverMessage', 'ReassignOrder')",
        ),
      params: z
        .record(z.unknown())
        .describe(
          "Action parameters as a JSON object (varies by action type)",
        ),
      reasoning: z
        .string()
        .describe(
          "Your explanation of why you are taking this action. This is logged to the audit trail.",
        ),
    }),
    func: async (input) => {
      try {
        const executionContext: ExecutionContext = {
          redis,
          state: store as unknown as Record<string, unknown>,
          correlationId: undefined,
          llmModel: "unknown",
          llmTokensUsed: 0,
          onAudit: (record) => {
            log.info(
              {
                actionType: record.actionType,
                outcome: record.outcome,
                agentId: record.agentId,
                auditId: record.id,
              },
              "Action audit recorded",
            );
          },
        };

        const result = await executeAction(
          input.actionName,
          input.params,
          input.reasoning,
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
      }
    },
  });

  // ------------------------------------------------------------------
  // 7. query_restaurants — Query restaurants with optional filters
  // ------------------------------------------------------------------

  const queryRestaurantsTool = new DynamicStructuredTool({
    name: "query_restaurants",
    description:
      "Query restaurants from the ontology with optional filters. Returns an array of restaurant summaries " +
      "including restaurantId, restaurantIdKey, name, deliveryZone, isActive, isOpen, isTabletOnline, " +
      "cuisine, and posEta. Use this to check restaurant health, find restaurants in a zone, or look up " +
      "restaurant info for tickets.",
    schema: z.object({
      deliveryZone: z
        .string()
        .nullable().optional()
        .describe("Filter by delivery zone / market name"),
      isActive: z
        .boolean()
        .nullable().optional()
        .describe("Filter by active status on the platform"),
      isOpen: z
        .boolean()
        .nullable().optional()
        .describe("Filter by whether restaurant is currently within kitchen hours"),
    }),
    func: async (input) => {
      try {
        const restaurants = store.queryRestaurants({
          deliveryZone: input.deliveryZone ?? undefined,
          isActive: input.isActive ?? undefined,
          isOpen: input.isOpen ?? undefined,
        });

        const summaries = restaurants.map((r) => ({
          restaurantId: r.restaurantId,
          restaurantIdKey: r.restaurantIdKey,
          name: r.name,
          deliveryZone: r.deliveryZone,
          isActive: r.isActive,
          isOpen: r.isOpen,
          isTabletOnline: r.isTabletOnline,
          cuisine: r.cuisine ?? null,
          posEta: r.posEta ?? null,
        }));

        return JSON.stringify({
          count: summaries.length,
          restaurants: summaries,
        });
      } catch (err) {
        log.error({ err, input }, "query_restaurants failed");
        return JSON.stringify({
          error: "Failed to query restaurants",
          details: String(err),
        });
      }
    },
  });

  // ------------------------------------------------------------------
  // 8. query_conversations — Query driver conversations
  // ------------------------------------------------------------------

  const queryConversationsTool = new DynamicStructuredTool({
    name: "query_conversations",
    description:
      "Query driver conversations from the ontology. Returns a list of conversations with driverId, " +
      "driverName (looked up from the driver store), lastMessagePreview, lastMessageAt, and hasUnread. " +
      "Use this to check message history and find conversations that need attention.",
    schema: z.object({
      hasUnread: z
        .boolean()
        .nullable().optional()
        .describe("Filter by unread status (true = only conversations with unread messages)"),
    }),
    func: async (input) => {
      try {
        const conversations = store.queryConversations({
          hasUnread: input.hasUnread ?? undefined,
        });

        const summaries = conversations.map((c) => {
          const driver = store.getDriver(c.driverId);
          return {
            driverId: c.driverId,
            driverName: driver?.name ?? c.driverId.split("@")[0],
            lastMessagePreview: c.lastMessagePreview,
            lastMessageAt: c.lastMessageAt.toISOString(),
            hasUnread: c.hasUnread,
          };
        });

        return JSON.stringify({
          count: summaries.length,
          conversations: summaries,
        });
      } catch (err) {
        log.error({ err, input }, "query_conversations failed");
        return JSON.stringify({
          error: "Failed to query conversations",
          details: String(err),
        });
      }
    },
  });

  // ------------------------------------------------------------------
  // 9. request_clarification — Pause and request help
  // ------------------------------------------------------------------

  const requestClarificationTool = new DynamicStructuredTool({
    name: "request_clarification",
    description:
      "Pause your current work and request clarification from the supervisor agent or a " +
      "human dispatcher. Use this when you are uncertain about the right course of action, " +
      "when an issue exceeds your authority, or when you encounter a safety concern. " +
      "The question and context will be routed to the appropriate handler based on urgency.",
    schema: z.object({
      question: z
        .string()
        .describe(
          "The specific question you need answered before proceeding",
        ),
      context: z
        .record(z.unknown())
        .describe(
          "Relevant context: entity IDs, what you've investigated so far, what you considered doing",
        ),
      urgency: z
        .enum(["normal", "high", "critical"])
        .nullable().optional()
        .default("normal")
        .describe(
          "Urgency level. 'critical' = safety issue or major customer impact, " +
          "'high' = time-sensitive, 'normal' = can wait for next check cycle",
        ),
    }),
    func: async (input) => {
      try {
        // Store the clarification request in Redis for the supervisor to pick up
        const requestId = `clarification:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

        const request = {
          requestId,
          agentId,
          question: input.question,
          context: input.context,
          urgency: input.urgency,
          createdAt: new Date().toISOString(),
          status: "pending",
        };

        // Store in Redis with a 24-hour TTL
        await redis.set(
          `clarification:${requestId}`,
          JSON.stringify(request),
          "EX",
          86400,
        );

        // Also push to a list for the supervisor to poll
        await redis.lpush("clarification:pending", JSON.stringify(request));

        log.info(
          { requestId, agentId, urgency: input.urgency },
          "Clarification requested",
        );

        return JSON.stringify({
          status: "pending",
          requestId,
          message:
            "Your clarification request has been submitted. " +
            (input.urgency === "critical"
              ? "A human dispatcher will be alerted immediately."
              : input.urgency === "high"
                ? "The supervisor will prioritize this on the next cycle."
                : "The supervisor will review this when available."),
          question: input.question,
        });
      } catch (err) {
        log.error({ err, input }, "request_clarification failed");
        return JSON.stringify({
          error: "Failed to submit clarification request",
          details: String(err),
        });
      }
    },
  });

  // ------------------------------------------------------------------
  // 10. get_ticket_details — Full ticket with embedded history
  // ------------------------------------------------------------------

  const getTicketDetailsTool = new DynamicStructuredTool({
    name: "get_ticket_details",
    description:
      "Get full details for a specific support ticket including description, notes, actions history, " +
      "and messages. Use this when you need the complete context of a ticket — for example, to read " +
      "the full description of a Dropped Shift ticket or to see what notes and actions have already " +
      "been taken. Takes a ticketId (8-char hash like '7645aca1').",
    schema: z.object({
      ticketId: z
        .string()
        .describe("The 8-character hash ID of the ticket (e.g. '7645aca1')"),
    }),
    func: async (input) => {
      try {
        const ticket = store.getTicket(input.ticketId);
        if (!ticket) {
          return JSON.stringify({
            error: "Ticket not found",
            ticketId: input.ticketId,
          });
        }

        // Resolve linked entities
        const relatedOrder = ticket.orderId
          ? store.getOrder(ticket.orderId)
          : undefined;
        const relatedDriver = ticket.driverId
          ? store.getDriver(ticket.driverId)
          : undefined;

        const result = {
          ticket: {
            issueId: ticket.issueId,
            status: ticket.status,
            category: ticket.category,
            issueType: ticket.issueType,
            market: ticket.market ?? null,
            originator: ticket.originator,
            owner: ticket.owner,
            description: ticket.description,
            createdAt: ticket.createdAt.toISOString(),
          },
          notes: (ticket.notes ?? []).map((n) => ({
            author: n.author,
            note: n.note,
            timestamp: n.timestamp.toISOString(),
          })),
          actions: (ticket.actions ?? []).map((a) => ({
            actor: a.actor,
            description: a.description,
            timestamp: a.timestamp.toISOString(),
          })),
          messages: (ticket.messages ?? []).map((m) => ({
            originator: m.originator,
            message: m.message,
            timestamp: m.sent.toISOString(),
          })),
          relatedOrder: relatedOrder
            ? {
                orderId: relatedOrder.orderId,
                orderIdKey: relatedOrder.orderIdKey,
                status: relatedOrder.status,
                restaurantName: relatedOrder.restaurantName,
                driverId: relatedOrder.driverId,
                deliveryZone: relatedOrder.deliveryZone,
                placedAt: relatedOrder.placedAt.toISOString(),
                isLate: relatedOrder.isLate,
              }
            : null,
          relatedDriver: relatedDriver
            ? {
                driverId: relatedDriver.driverId,
                name: relatedDriver.name,
                phone: relatedDriver.phone,
                dispatchZone: relatedDriver.dispatchZone,
                isOnline: relatedDriver.isOnline,
                activeOrdersCount: relatedDriver.activeOrdersCount,
              }
            : null,
        };

        return JSON.stringify(result);
      } catch (err) {
        log.error({ err, input }, "get_ticket_details failed");
        return JSON.stringify({
          error: "Failed to get ticket details",
          details: String(err),
        });
      }
    },
  });

  // ------------------------------------------------------------------
  // 11. query_driver_shifts — Check shift coverage via DynamoDB
  // ------------------------------------------------------------------

  const queryDriverShiftsTool = new DynamicStructuredTool({
    name: "query_driver_shifts",
    description:
      "Check which drivers are scheduled for shifts in a market during a time window. " +
      "Use this to verify coverage when a driver drops a shift. Queries the DynamoDB " +
      "ValleyEats-DriverShifts table directly. Takes a market name and a time range.",
    schema: z.object({
      market: z
        .string()
        .describe("Market name (e.g. 'Pembroke')"),
      startTime: z
        .string()
        .describe("Start of the time window as ISO datetime (e.g. '2026-03-26T11:00:00')"),
      endTime: z
        .string()
        .describe("End of the time window as ISO datetime (e.g. '2026-03-26T16:00:00')"),
    }),
    func: async (input) => {
      try {
        if (!dynamoClient) {
          return JSON.stringify({
            error: "DynamoDB not available. Cannot query driver shifts.",
          });
        }

        const startEpoch = Math.floor(new Date(input.startTime).getTime() / 1000);
        const endEpoch = Math.floor(new Date(input.endTime).getTime() / 1000);

        if (isNaN(startEpoch) || isNaN(endEpoch)) {
          return JSON.stringify({
            error: "Invalid date format. Use ISO datetime (e.g. '2026-03-26T11:00:00').",
          });
        }

        const command = new QueryCommand({
          TableName: "ValleyEats-DriverShifts",
          IndexName: "Market-index",
          KeyConditionExpression:
            "Market = :m AND shiftstart BETWEEN :start AND :end",
          ExpressionAttributeValues: {
            ":m": { S: input.market },
            ":start": { N: String(startEpoch) },
            ":end": { N: String(endEpoch) },
          },
        });

        const response = await dynamoClient.send(command);
        const items = (response.Items ?? []).map((item) => unmarshall(item));

        const shifts = items.map((item) => {
          const driverId = (item.DriverId as string) ?? "";
          const driver = store.getDriver(driverId);
          return {
            driverId,
            driverName: driver?.name ?? driverId.split("@")[0],
            shiftStart: new Date((item.shiftstart as number) * 1000).toISOString(),
            shiftEnd: new Date((item.shiftend as number) * 1000).toISOString(),
          };
        });

        return JSON.stringify({
          market: input.market,
          startTime: input.startTime,
          endTime: input.endTime,
          count: shifts.length,
          shifts,
        });
      } catch (err) {
        log.error({ err, input }, "query_driver_shifts failed");
        return JSON.stringify({
          error: "Failed to query driver shifts",
          details: String(err),
        });
      }
    },
  });

  // ------------------------------------------------------------------
  // Return all tools
  // ------------------------------------------------------------------

  return [
    queryOrdersTool,
    queryDriversTool,
    queryTicketsTool,
    queryRestaurantsTool,
    queryConversationsTool,
    getOrderDetailsTool,
    getTicketDetailsTool,
    queryDriverShiftsTool,
    getEntityTimelineTool,
    executeActionTool,
    requestClarificationTool,
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a simple world-state snapshot from the ontology store.
 * Used by the guardrails executor for submission criteria validation.
 */
function buildWorldState(store: OntologyStore): Record<string, unknown> {
  return {
    orders: Object.fromEntries(store.orders),
    drivers: Object.fromEntries(store.drivers),
    restaurants: Object.fromEntries(store.restaurants),
    customers: Object.fromEntries(store.customers),
    tickets: Object.fromEntries(store.tickets),
    markets: Object.fromEntries(store.markets),
    conversations: Object.fromEntries(store.conversations),
  };
}
