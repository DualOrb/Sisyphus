/**
 * Priority event queue for the Sisyphus dispatch pipeline.
 *
 * Events are dequeued in priority order (critical > high > normal > low).
 * Within the same priority level, FIFO ordering is preserved.
 *
 * The queue is bounded — when it reaches MAX_QUEUE_SIZE the lowest-priority
 * events are dropped to make room for new arrivals.
 */

import type { PrioritizedEvent, EventPriority } from "./types.js";
import { PRIORITY_WEIGHT } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_QUEUE_SIZE = 500;

/**
 * Priority levels in descending order of importance.
 * Used when we need to find the lowest-priority bucket to evict from.
 */
const PRIORITY_ORDER: EventPriority[] = ["critical", "high", "normal", "low"];

// ---------------------------------------------------------------------------
// EventQueue
// ---------------------------------------------------------------------------

export class EventQueue {
  /**
   * Internal storage — one array per priority level.
   * This gives us O(1) FIFO within each bucket and clean priority ordering.
   */
  private buckets: Record<EventPriority, PrioritizedEvent[]> = {
    critical: [],
    high: [],
    normal: [],
    low: [],
  };

  private _size = 0;

  // ---- Public API --------------------------------------------------------

  /** Total number of events in the queue. */
  get size(): number {
    return this._size;
  }

  /** Whether the queue is empty. */
  get isEmpty(): boolean {
    return this._size === 0;
  }

  /** Add a single event to the queue. */
  enqueue(event: PrioritizedEvent): void {
    // If full, evict the lowest-priority event
    if (this._size >= MAX_QUEUE_SIZE) {
      this.evictLowest();
    }

    this.buckets[event.priority].push(event);
    this._size++;
  }

  /** Add multiple events to the queue. */
  enqueueAll(events: PrioritizedEvent[]): void {
    for (const event of events) {
      this.enqueue(event);
    }
  }

  /**
   * Remove and return the highest-priority event.
   * Returns `undefined` if the queue is empty.
   */
  dequeue(): PrioritizedEvent | undefined {
    for (const priority of PRIORITY_ORDER) {
      const bucket = this.buckets[priority];
      if (bucket.length > 0) {
        this._size--;
        return bucket.shift()!;
      }
    }
    return undefined;
  }

  /**
   * Peek at the next event without removing it.
   * Returns `undefined` if the queue is empty.
   */
  peek(): PrioritizedEvent | undefined {
    for (const priority of PRIORITY_ORDER) {
      const bucket = this.buckets[priority];
      if (bucket.length > 0) {
        return bucket[0];
      }
    }
    return undefined;
  }

  /**
   * Drain all events from the queue in priority order and clear it.
   * Returns all events as a flat array (critical first, then high, etc.).
   */
  drain(): PrioritizedEvent[] {
    const result: PrioritizedEvent[] = [];

    for (const priority of PRIORITY_ORDER) {
      const bucket = this.buckets[priority];
      result.push(...bucket);
      bucket.length = 0;
    }

    this._size = 0;
    return result;
  }

  // ---- Internal ----------------------------------------------------------

  /**
   * Drop the last (oldest within the lowest-priority non-empty bucket)
   * event to make room for a new one.
   */
  private evictLowest(): void {
    // Walk from lowest priority up — evict from the lowest non-empty bucket
    for (let i = PRIORITY_ORDER.length - 1; i >= 0; i--) {
      const bucket = this.buckets[PRIORITY_ORDER[i]];
      if (bucket.length > 0) {
        bucket.shift(); // drop oldest in that bucket
        this._size--;
        return;
      }
    }
  }
}
