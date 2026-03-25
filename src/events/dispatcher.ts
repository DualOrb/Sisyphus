/**
 * Event dispatcher — converts prioritized events into natural-language
 * messages that the LangGraph supervisor agent can understand.
 *
 * The dispatcher formats individual events, groups them by priority,
 * and builds a combined prompt that gives the supervisor a clear picture
 * of everything that needs attention in this dispatch cycle.
 */

import type { PrioritizedEvent, EventPriority, DispatchEvent } from "./types.js";
import { PRIORITY_WEIGHT } from "./types.js";

// ---------------------------------------------------------------------------
// Priority label mapping
// ---------------------------------------------------------------------------

const PRIORITY_LABEL: Record<EventPriority, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  normal: "NORMAL",
  low: "LOW",
};

// ---------------------------------------------------------------------------
// EventDispatcher
// ---------------------------------------------------------------------------

export class EventDispatcher {
  /**
   * Format a single event into a human-readable description.
   */
  formatEventForAgent(pe: PrioritizedEvent): string {
    const label = PRIORITY_LABEL[pe.priority];
    const desc = this.describeEvent(pe.event);
    return `[${label}] ${desc}`;
  }

  /**
   * Combine multiple events into a single dispatch message for the supervisor.
   *
   * Groups events by priority level so the supervisor can triage top-down.
   */
  buildDispatchMessage(events: PrioritizedEvent[]): string {
    if (events.length === 0) {
      return "No events to process this cycle.";
    }

    // Sort by priority weight then createdAt
    const sorted = [...events].sort((a, b) => {
      const pw = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      if (pw !== 0) return pw;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const lines: string[] = ["PRIORITY EVENTS:"];
    let idx = 1;

    for (const pe of sorted) {
      lines.push(`${idx}. ${this.formatEventForAgent(pe)}`);
      idx++;
    }

    // Append a summary footer
    const counts = this.countByPriority(sorted);
    const summaryParts: string[] = [];
    for (const p of (["critical", "high", "normal", "low"] as EventPriority[])) {
      if (counts[p] > 0) {
        summaryParts.push(`${counts[p]} ${PRIORITY_LABEL[p]}`);
      }
    }
    lines.push("");
    lines.push(`Summary: ${sorted.length} events (${summaryParts.join(", ")}). Triage and delegate as needed.`);

    return lines.join("\n");
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private describeEvent(event: DispatchEvent): string {
    switch (event.type) {
      case "new_driver_message":
        return `New message from driver ${event.driverName} (${event.driverId}): "${event.message}"`;

      case "unassigned_order":
        return (
          `Order ${event.orderIdKey} from ${event.restaurantName} in ${event.deliveryZone} ` +
          `has been unassigned for ${event.minutesPending} minutes.`
        );

      case "market_alert": {
        const levelTag = event.alertLevel === "critical" ? "CRITICAL" : "WARNING";
        return (
          `${event.market} market score is ${event.score} (${levelTag}) ` +
          `\u2014 ${event.availableDrivers} drivers for ${event.idealDrivers} needed.`
        );
      }

      case "ticket_update":
        return (
          `Ticket ${event.ticketId} [${event.category}] in ${event.market} ` +
          `is in "${event.status}" status.`
        );

      case "order_status_change":
        return `Order ${event.orderId} changed status: ${event.oldStatus} -> ${event.newStatus}.`;

      case "driver_offline":
        return (
          `Driver ${event.driverName} (${event.driverId}) went offline ` +
          `with ${event.activeOrders} active order${event.activeOrders === 1 ? "" : "s"}.`
        );

      case "shift_event":
        switch (event.event) {
          case "start":
            return "Shift has started. Begin monitoring dispatch operations.";
          case "end":
            return "Shift is ending. Wrap up remaining tasks and hand off.";
          case "approaching_end":
            return "Shift is approaching its end. Prioritize critical items and prepare for handoff.";
        }
    }
  }

  private countByPriority(events: PrioritizedEvent[]): Record<EventPriority, number> {
    const counts: Record<EventPriority, number> = {
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
    };
    for (const e of events) {
      counts[e.priority]++;
    }
    return counts;
  }
}
