/**
 * WebSocket client for the ValleyEats dispatch real-time system.
 *
 * Connects to the API Gateway WebSocket at the dispatch WS URL with a Cognito
 * access token. Once connected, Sisyphus appears as a live user in the dispatch
 * UI, receives driver messages, and gets dispatch presence updates.
 *
 * The connection is stored server-side in the ValleyEats-DispatchConnections
 * DynamoDB table with a 24-hour TTL.
 *
 * @see planning/10-data-model-discovery.md section 20
 */

import WebSocket from "ws";
import { createChildLogger } from "../../lib/logger.js";

const log = createChildLogger("websocket:client");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PresenceUser {
  connectionId: string;
  name: string;
  picture: string | null;
  route: string;
  viewMode: string;
  onCall: boolean;
}

export interface DriverMessage {
  messageId: string;
  driverId: string;
  driverName: string;
  content: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface PresenceUpdatePayload {
  type: "presence_update";
  route: string;
  viewMode: string;
  onCall: boolean;
  name: string;
  picture: string | null;
}

type MessageHandler = (driverId: string, message: DriverMessage) => void;
type PresenceSnapshotHandler = (users: PresenceUser[]) => void;
type PresenceUpdateHandler = (user: PresenceUser) => void;
type ErrorHandler = (error: Error) => void;
type CloseHandler = (code: number, reason: string) => void;

// ---------------------------------------------------------------------------
// Reconnect constants
// ---------------------------------------------------------------------------

const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;
const RECONNECT_MULTIPLIER = 2;
const HEARTBEAT_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// DispatchWebSocket
// ---------------------------------------------------------------------------

export class DispatchWebSocket {
  private ws: WebSocket | null = null;
  private wsUrl: string | null = null;
  private authToken: string | null = null;

  private reconnectDelay = INITIAL_RECONNECT_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;
  private _connected = false;

  // Event handlers
  private messageHandlers: MessageHandler[] = [];
  private presenceSnapshotHandlers: PresenceSnapshotHandler[] = [];
  private presenceUpdateHandlers: PresenceUpdateHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private closeHandlers: CloseHandler[] = [];

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Whether the underlying WebSocket is currently open. */
  get connected(): boolean {
    return this._connected;
  }

  /**
   * Open a WebSocket connection to the dispatch system.
   *
   * The token is appended as a query parameter per the API Gateway authorizer
   * convention: `wss://...?token={cognitoAccessToken}`.
   */
  connect(wsUrl: string, authToken: string): void {
    this.wsUrl = wsUrl;
    this.authToken = authToken;
    this.intentionalClose = false;
    this.reconnectDelay = INITIAL_RECONNECT_MS;
    this.establishConnection();
  }

  /** Gracefully close the connection. Does not trigger auto-reconnect. */
  disconnect(): void {
    this.intentionalClose = true;
    this.clearTimers();

    if (this.ws) {
      log.info("Disconnecting from dispatch WebSocket");
      this.ws.close(1000, "Sisyphus shutting down");
      this.ws = null;
    }

    this._connected = false;
  }

  /** Send a presence_update event to broadcast Sisyphus state to the dispatch UI. */
  sendPresenceUpdate(data: PresenceUpdatePayload): void {
    this.send(JSON.stringify({ action: "presence_update", data }));
  }

  /** Send an arbitrary JSON string over the connection. */
  send(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn("Cannot send — WebSocket is not open");
      return;
    }
    this.ws.send(data);
  }

  // -------------------------------------------------------------------------
  // Event registration
  // -------------------------------------------------------------------------

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onPresenceSnapshot(handler: PresenceSnapshotHandler): void {
    this.presenceSnapshotHandlers.push(handler);
  }

  onPresenceUpdate(handler: PresenceUpdateHandler): void {
    this.presenceUpdateHandlers.push(handler);
  }

  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private establishConnection(): void {
    if (!this.wsUrl || !this.authToken) return;

    const separator = this.wsUrl.includes("?") ? "&" : "?";
    const fullUrl = `${this.wsUrl}${separator}token=${this.authToken}`;

    log.info({ url: this.wsUrl }, "Connecting to dispatch WebSocket");

    this.ws = new WebSocket(fullUrl);

    this.ws.on("open", () => {
      this._connected = true;
      this.reconnectDelay = INITIAL_RECONNECT_MS;
      log.info("WebSocket connection established");
      this.startHeartbeat();
    });

    this.ws.on("message", (raw: WebSocket.RawData) => {
      this.handleIncomingMessage(raw);
    });

    this.ws.on("error", (err: Error) => {
      log.error({ err }, "WebSocket error");
      for (const handler of this.errorHandlers) {
        handler(err);
      }
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      this._connected = false;
      const reasonStr = reason.toString();
      log.info({ code, reason: reasonStr }, "WebSocket connection closed");

      this.stopHeartbeat();

      for (const handler of this.closeHandlers) {
        handler(code, reasonStr);
      }

      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    });
  }

  private handleIncomingMessage(raw: WebSocket.RawData): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      log.warn({ raw: raw.toString().slice(0, 200) }, "Unparseable WebSocket message");
      return;
    }

    const eventType = parsed.type as string | undefined;

    switch (eventType) {
      case "presence_snapshot": {
        const users = (parsed.users ?? parsed.data ?? []) as PresenceUser[];
        for (const handler of this.presenceSnapshotHandlers) {
          handler(users);
        }
        break;
      }

      case "presence_update": {
        const user = (parsed.user ?? parsed.data ?? parsed) as PresenceUser;
        for (const handler of this.presenceUpdateHandlers) {
          handler(user);
        }
        break;
      }

      case "new_message": {
        const message = (parsed.message ?? parsed.data ?? parsed) as DriverMessage;
        const driverId = message.driverId ?? (parsed.driverId as string) ?? "unknown";
        for (const handler of this.messageHandlers) {
          handler(driverId, message);
        }
        break;
      }

      default:
        log.debug({ eventType, keys: Object.keys(parsed) }, "Unhandled WebSocket event type");
    }
  }

  // -------------------------------------------------------------------------
  // Reconnect
  // -------------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    log.info({ delayMs: this.reconnectDelay }, "Scheduling WebSocket reconnect");

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.establishConnection();
    }, this.reconnectDelay);

    // Exponential backoff
    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_MULTIPLIER,
      MAX_RECONNECT_MS,
    );
  }

  // -------------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        log.debug("Heartbeat ping sent");
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
