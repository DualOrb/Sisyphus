/**
 * Event type definitions for the Sisyphus dispatch event pipeline.
 *
 * All events flowing through the system are represented as a discriminated
 * union on `type`. The pipeline detects these events from ontology state
 * changes, prioritises them, and feeds them into the LangGraph agent graph.
 */

// ---------------------------------------------------------------------------
// Dispatch event — discriminated union
// ---------------------------------------------------------------------------

export interface NewDriverMessageEvent {
  type: "new_driver_message";
  driverId: string;
  driverName: string;
  message: string;
  timestamp: Date;
}

export interface UnassignedOrderEvent {
  type: "unassigned_order";
  orderId: string;
  orderIdKey: string;
  restaurantName: string;
  deliveryZone: string;
  minutesPending: number;
}

export interface MarketAlertEvent {
  type: "market_alert";
  market: string;
  score: number;
  idealDrivers: number;
  availableDrivers: number;
  alertLevel: string;
}

export interface TicketUpdateEvent {
  type: "ticket_update";
  ticketId: string;
  status: string;
  category: string;
  market: string;
}

export interface OrderStatusChangeEvent {
  type: "order_status_change";
  orderId: string;
  oldStatus: string;
  newStatus: string;
}

export interface DriverOfflineEvent {
  type: "driver_offline";
  driverId: string;
  driverName: string;
  activeOrders: number;
}

export interface ShiftEvent {
  type: "shift_event";
  event: "start" | "end" | "approaching_end";
}

export type DispatchEvent =
  | NewDriverMessageEvent
  | UnassignedOrderEvent
  | MarketAlertEvent
  | TicketUpdateEvent
  | OrderStatusChangeEvent
  | DriverOfflineEvent
  | ShiftEvent;

// ---------------------------------------------------------------------------
// Priority classification
// ---------------------------------------------------------------------------

export type EventPriority = "critical" | "high" | "normal" | "low";

/**
 * Numeric weight for each priority level.  Lower value = higher priority.
 * Used by the EventQueue to sort events.
 */
export const PRIORITY_WEIGHT: Record<EventPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// ---------------------------------------------------------------------------
// Prioritised event wrapper
// ---------------------------------------------------------------------------

export interface PrioritizedEvent {
  event: DispatchEvent;
  priority: EventPriority;
  createdAt: Date;
}
