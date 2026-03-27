/**
 * Server-Sent Events manager for the Sisyphus dashboard.
 *
 * Maintains a set of connected SSE clients and broadcasts typed events.
 * Each event is a JSON-encoded payload with an `event:` type prefix.
 */

import type http from "node:http";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("api:sse");

const KEEPALIVE_INTERVAL_MS = 15_000;

export class SseManager {
  private clients = new Set<http.ServerResponse>();
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.keepaliveTimer = setInterval(() => {
      for (const res of this.clients) {
        try {
          res.write(": keepalive\n\n");
        } catch {
          this.clients.delete(res);
        }
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  /** Handle an incoming SSE connection request. */
  connect(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    // Send initial connection confirmation
    res.write(`event: connected\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);

    this.clients.add(res);
    log.info({ clients: this.clients.size }, "SSE client connected");

    req.on("close", () => {
      this.clients.delete(res);
      log.info({ clients: this.clients.size }, "SSE client disconnected");
    });
  }

  /** Broadcast a typed event to all connected clients. */
  broadcast(eventType: string, data: unknown): void {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  /** Number of currently connected clients. */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Stop keepalive timer and close all connections. */
  shutdown(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    for (const res of this.clients) {
      try {
        res.end();
      } catch { /* ignore */ }
    }
    this.clients.clear();
  }
}
