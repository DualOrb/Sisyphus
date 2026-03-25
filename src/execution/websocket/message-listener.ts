/**
 * Driver message listener — queues incoming driver messages for agent processing.
 *
 * When a driver sends a message through the dispatch system, it arrives here
 * as a `new_message` WebSocket event. Messages are buffered in a bounded queue
 * until the agent pipeline pulls them for processing.
 *
 * Queue semantics:
 * - Max 100 pending messages (configurable)
 * - When full, the oldest message is dropped to make room
 * - `getUnprocessedMessages()` returns a snapshot (does not drain)
 * - `markProcessed(messageId)` removes a specific message from the queue
 */

import type { DispatchWebSocket, DriverMessage } from "./client.js";
import { createChildLogger } from "../../lib/logger.js";

const log = createChildLogger("websocket:messages");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueuedMessage {
  /** Unique identifier for this queued entry. */
  messageId: string;
  /** Driver's identifier (typically email). */
  driverId: string;
  /** Driver's display name. */
  driverName: string;
  /** Message text content. */
  content: string;
  /** ISO timestamp from the dispatch system. */
  timestamp: string;
  /** When this message was received by the listener. */
  receivedAt: Date;
  /** The full raw payload for downstream consumers. */
  raw: DriverMessage;
}

// ---------------------------------------------------------------------------
// MessageListener
// ---------------------------------------------------------------------------

const DEFAULT_MAX_QUEUE_SIZE = 100;

export class MessageListener {
  private queue: QueuedMessage[] = [];
  private readonly maxQueueSize: number;
  private messageCounter = 0;

  constructor(maxQueueSize = DEFAULT_MAX_QUEUE_SIZE) {
    this.maxQueueSize = maxQueueSize;
  }

  /**
   * Attach this listener to a DispatchWebSocket client.
   *
   * Registers the `onMessage` handler so incoming driver messages are
   * automatically queued.
   */
  attach(wsClient: DispatchWebSocket): void {
    wsClient.onMessage((driverId, message) => {
      this.enqueue(driverId, message);
    });
    log.info("Message listener attached to WebSocket client");
  }

  /**
   * Manually enqueue a driver message.
   *
   * This is useful for testing or for injecting messages from sources other
   * than the WebSocket (e.g. polling fallback).
   */
  enqueue(driverId: string, message: DriverMessage): void {
    const queued: QueuedMessage = {
      messageId: message.messageId ?? this.generateId(),
      driverId,
      driverName: message.driverName ?? "Unknown Driver",
      content: message.content ?? "",
      timestamp: message.timestamp ?? new Date().toISOString(),
      receivedAt: new Date(),
      raw: message,
    };

    // Enforce bounded queue — drop oldest if full
    if (this.queue.length >= this.maxQueueSize) {
      const dropped = this.queue.shift();
      log.warn(
        { droppedMessageId: dropped?.messageId, queueSize: this.maxQueueSize },
        "Message queue full — dropped oldest message",
      );
    }

    this.queue.push(queued);
    log.debug(
      { messageId: queued.messageId, driverId, queueSize: this.queue.length },
      "Driver message queued",
    );
  }

  /** Returns all pending (unprocessed) messages as a snapshot array. */
  getUnprocessedMessages(): QueuedMessage[] {
    return [...this.queue];
  }

  /** Number of messages currently in the queue. */
  get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * Remove a processed message from the queue by its messageId.
   *
   * Returns `true` if the message was found and removed, `false` otherwise.
   */
  markProcessed(messageId: string): boolean {
    const index = this.queue.findIndex((m) => m.messageId === messageId);
    if (index === -1) {
      log.debug({ messageId }, "markProcessed: message not found in queue");
      return false;
    }

    this.queue.splice(index, 1);
    log.debug({ messageId, queueSize: this.queue.length }, "Message marked as processed");
    return true;
  }

  /** Clear the entire queue. */
  clear(): void {
    const count = this.queue.length;
    this.queue = [];
    log.info({ droppedCount: count }, "Message queue cleared");
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private generateId(): string {
    this.messageCounter += 1;
    return `msg-${Date.now()}-${this.messageCounter}`;
  }
}
