/**
 * Presence management for Sisyphus in the dispatch UI.
 *
 * The dispatch frontend displays all connected users (dispatchers, admins, and
 * now Sisyphus) via WebSocket presence events. This module maintains the local
 * presence state and broadcasts updates so that human operators can see what
 * Sisyphus is currently doing.
 *
 * Presence payload format (must match the dispatch frontend):
 * ```
 * {
 *   type: "presence_update",
 *   route: "/dispatch",
 *   viewMode: "Dispatch",
 *   onCall: false,
 *   name: "Sisyphus",
 *   picture: null
 * }
 * ```
 */

import type { DispatchWebSocket, PresenceUpdatePayload } from "./client.js";
import { createChildLogger } from "../../lib/logger.js";

const log = createChildLogger("websocket:presence");

// ---------------------------------------------------------------------------
// SisyphusPresence
// ---------------------------------------------------------------------------

export class SisyphusPresence {
  private wsClient: DispatchWebSocket;

  private route = "/dispatch";
  private viewMode = "Dispatch";
  private onCall = false;
  private name = "Sisyphus";
  private picture: string | null = null;

  constructor(wsClient: DispatchWebSocket) {
    this.wsClient = wsClient;
  }

  // -------------------------------------------------------------------------
  // State mutators — each sends an immediate presence broadcast
  // -------------------------------------------------------------------------

  /** Update the route Sisyphus is "viewing" (e.g. "/dispatch", "/support"). */
  updateRoute(route: string): void {
    this.route = route;
    log.debug({ route }, "Route updated");
    this.broadcast();
  }

  /** Update the view mode (e.g. "Dispatch", "Flex", "Support"). */
  updateViewMode(mode: string): void {
    this.viewMode = mode;
    log.debug({ viewMode: mode }, "View mode updated");
    this.broadcast();
  }

  /**
   * Update the human-readable activity description.
   *
   * This is encoded in the route field so other dispatchers can see what
   * Sisyphus is currently working on (e.g. "/dispatch — processing 12 orders").
   */
  updateActivity(description: string): void {
    this.route = description;
    log.debug({ activity: description }, "Activity updated");
    this.broadcast();
  }

  /** Set the on-call flag (normally false for the AI). */
  setOnCall(onCall: boolean): void {
    this.onCall = onCall;
    this.broadcast();
  }

  // -------------------------------------------------------------------------
  // Read current state
  // -------------------------------------------------------------------------

  /** Returns the current presence payload (useful for tests / introspection). */
  getPayload(): PresenceUpdatePayload {
    return {
      type: "presence_update",
      route: this.route,
      viewMode: this.viewMode,
      onCall: this.onCall,
      name: this.name,
      picture: this.picture,
    };
  }

  // -------------------------------------------------------------------------
  // Broadcast
  // -------------------------------------------------------------------------

  /** Send the current presence state over the WebSocket. */
  broadcast(): void {
    const payload = this.getPayload();
    log.debug({ payload }, "Broadcasting presence update");
    this.wsClient.sendPresenceUpdate(payload);
  }
}
