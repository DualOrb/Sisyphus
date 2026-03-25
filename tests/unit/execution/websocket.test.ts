/**
 * Unit tests for the dispatch WebSocket module.
 *
 * Covers: SisyphusPresence, MessageListener, DispatchWebSocket (surface-level).
 *
 * The WebSocket client itself is not connected to a real server — we mock the
 * underlying `ws` library and test the higher-level presence and message logic
 * independently.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SisyphusPresence } from "@execution/websocket/presence";
import { MessageListener } from "@execution/websocket/message-listener";
import type { DispatchWebSocket, DriverMessage } from "@execution/websocket/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a mock DispatchWebSocket with a spied sendPresenceUpdate. */
function createMockWsClient(): DispatchWebSocket {
  return {
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendPresenceUpdate: vi.fn(),
    send: vi.fn(),
    onMessage: vi.fn(),
    onPresenceSnapshot: vi.fn(),
    onPresenceUpdate: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
  } as unknown as DispatchWebSocket;
}

function makeDriverMessage(overrides: Partial<DriverMessage> = {}): DriverMessage {
  return {
    messageId: `msg-${Math.random().toString(36).slice(2)}`,
    driverId: "driver@example.com",
    driverName: "Test Driver",
    content: "I'm running late",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SisyphusPresence
// ---------------------------------------------------------------------------

describe("SisyphusPresence", () => {
  let wsClient: DispatchWebSocket;
  let presence: SisyphusPresence;

  beforeEach(() => {
    wsClient = createMockWsClient();
    presence = new SisyphusPresence(wsClient);
  });

  it("produces a correctly formatted presence payload", () => {
    const payload = presence.getPayload();

    expect(payload).toEqual({
      type: "presence_update",
      route: "/dispatch",
      viewMode: "Dispatch",
      onCall: false,
      name: "Sisyphus",
      picture: null,
    });
  });

  it("sends presence_update via the WebSocket client on broadcast", () => {
    presence.broadcast();

    expect(wsClient.sendPresenceUpdate).toHaveBeenCalledTimes(1);
    expect(wsClient.sendPresenceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "presence_update", name: "Sisyphus" }),
    );
  });

  it("updates route and broadcasts", () => {
    presence.updateRoute("/support");

    const payload = presence.getPayload();
    expect(payload.route).toBe("/support");
    expect(wsClient.sendPresenceUpdate).toHaveBeenCalledTimes(1);
  });

  it("updates viewMode and broadcasts", () => {
    presence.updateViewMode("Flex");

    const payload = presence.getPayload();
    expect(payload.viewMode).toBe("Flex");
    expect(wsClient.sendPresenceUpdate).toHaveBeenCalledTimes(1);
  });

  it("updates activity (sets route to description) and broadcasts", () => {
    presence.updateActivity("/dispatch — processing 12 orders");

    const payload = presence.getPayload();
    expect(payload.route).toBe("/dispatch — processing 12 orders");
    expect(wsClient.sendPresenceUpdate).toHaveBeenCalledTimes(1);
  });

  it("keeps onCall false by default", () => {
    expect(presence.getPayload().onCall).toBe(false);
  });

  it("name is always Sisyphus", () => {
    presence.updateRoute("/orders");
    presence.updateViewMode("Support");
    expect(presence.getPayload().name).toBe("Sisyphus");
  });

  it("accumulates state across multiple updates", () => {
    presence.updateRoute("/flex");
    presence.updateViewMode("Flex");

    const payload = presence.getPayload();
    expect(payload.route).toBe("/flex");
    expect(payload.viewMode).toBe("Flex");
    expect(payload.name).toBe("Sisyphus");
    expect(payload.picture).toBeNull();

    // Two updates = two broadcasts
    expect(wsClient.sendPresenceUpdate).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// MessageListener
// ---------------------------------------------------------------------------

describe("MessageListener", () => {
  let listener: MessageListener;

  beforeEach(() => {
    listener = new MessageListener();
  });

  it("queues an incoming driver message", () => {
    const msg = makeDriverMessage({ messageId: "msg-1", driverId: "d1@test.com" });
    listener.enqueue("d1@test.com", msg);

    const pending = listener.getUnprocessedMessages();
    expect(pending).toHaveLength(1);
    expect(pending[0].messageId).toBe("msg-1");
    expect(pending[0].driverId).toBe("d1@test.com");
    expect(pending[0].content).toBe("I'm running late");
  });

  it("returns a snapshot — not a reference to the internal queue", () => {
    listener.enqueue("d1@test.com", makeDriverMessage());

    const snapshot = listener.getUnprocessedMessages();
    snapshot.pop(); // mutating the snapshot

    expect(listener.getUnprocessedMessages()).toHaveLength(1);
  });

  it("dequeues the correct message with markProcessed", () => {
    listener.enqueue("d1@test.com", makeDriverMessage({ messageId: "msg-A" }));
    listener.enqueue("d2@test.com", makeDriverMessage({ messageId: "msg-B" }));
    listener.enqueue("d3@test.com", makeDriverMessage({ messageId: "msg-C" }));

    const removed = listener.markProcessed("msg-B");

    expect(removed).toBe(true);
    expect(listener.pendingCount).toBe(2);

    const ids = listener.getUnprocessedMessages().map((m) => m.messageId);
    expect(ids).toEqual(["msg-A", "msg-C"]);
  });

  it("returns false when marking a non-existent message as processed", () => {
    listener.enqueue("d1@test.com", makeDriverMessage({ messageId: "msg-1" }));

    expect(listener.markProcessed("msg-nonexistent")).toBe(false);
    expect(listener.pendingCount).toBe(1);
  });

  it("tracks pending count", () => {
    expect(listener.pendingCount).toBe(0);

    listener.enqueue("d1@test.com", makeDriverMessage());
    listener.enqueue("d2@test.com", makeDriverMessage());

    expect(listener.pendingCount).toBe(2);
  });

  it("clears the queue", () => {
    listener.enqueue("d1@test.com", makeDriverMessage());
    listener.enqueue("d2@test.com", makeDriverMessage());

    listener.clear();

    expect(listener.pendingCount).toBe(0);
    expect(listener.getUnprocessedMessages()).toEqual([]);
  });

  it("preserves the raw message in the queued entry", () => {
    const msg = makeDriverMessage({ messageId: "raw-1", content: "hello" });
    listener.enqueue("d1@test.com", msg);

    const queued = listener.getUnprocessedMessages()[0];
    expect(queued.raw).toEqual(msg);
  });

  it("sets receivedAt to approximately now", () => {
    const before = new Date();
    listener.enqueue("d1@test.com", makeDriverMessage());
    const after = new Date();

    const queued = listener.getUnprocessedMessages()[0];
    expect(queued.receivedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(queued.receivedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ---------------------------------------------------------------------------
// MessageListener — bounded queue
// ---------------------------------------------------------------------------

describe("MessageListener — bounded queue", () => {
  it("drops oldest messages when queue exceeds max size", () => {
    const maxSize = 5;
    const listener = new MessageListener(maxSize);

    // Fill the queue to capacity
    for (let i = 1; i <= 5; i++) {
      listener.enqueue(`d${i}@test.com`, makeDriverMessage({ messageId: `msg-${i}` }));
    }
    expect(listener.pendingCount).toBe(5);

    // Add one more — should drop msg-1
    listener.enqueue("d6@test.com", makeDriverMessage({ messageId: "msg-6" }));

    expect(listener.pendingCount).toBe(5);
    const ids = listener.getUnprocessedMessages().map((m) => m.messageId);
    expect(ids).toEqual(["msg-2", "msg-3", "msg-4", "msg-5", "msg-6"]);
    expect(ids).not.toContain("msg-1");
  });

  it("continues dropping oldest when multiple messages overflow", () => {
    const listener = new MessageListener(3);

    listener.enqueue("d1@test.com", makeDriverMessage({ messageId: "A" }));
    listener.enqueue("d2@test.com", makeDriverMessage({ messageId: "B" }));
    listener.enqueue("d3@test.com", makeDriverMessage({ messageId: "C" }));
    listener.enqueue("d4@test.com", makeDriverMessage({ messageId: "D" }));
    listener.enqueue("d5@test.com", makeDriverMessage({ messageId: "E" }));

    expect(listener.pendingCount).toBe(3);
    const ids = listener.getUnprocessedMessages().map((m) => m.messageId);
    expect(ids).toEqual(["C", "D", "E"]);
  });

  it("defaults to max 100 messages", () => {
    const listener = new MessageListener();

    for (let i = 0; i < 105; i++) {
      listener.enqueue("d@test.com", makeDriverMessage({ messageId: `m-${i}` }));
    }

    expect(listener.pendingCount).toBe(100);

    // Oldest 5 should have been dropped
    const ids = listener.getUnprocessedMessages().map((m) => m.messageId);
    expect(ids[0]).toBe("m-5");
    expect(ids[ids.length - 1]).toBe("m-104");
  });
});

// ---------------------------------------------------------------------------
// MessageListener.attach
// ---------------------------------------------------------------------------

describe("MessageListener.attach", () => {
  it("registers an onMessage handler on the WebSocket client", () => {
    const wsClient = createMockWsClient();
    const listener = new MessageListener();

    listener.attach(wsClient);

    expect(wsClient.onMessage).toHaveBeenCalledTimes(1);
    expect(wsClient.onMessage).toHaveBeenCalledWith(expect.any(Function));
  });

  it("queues messages when the registered handler is invoked", () => {
    const wsClient = createMockWsClient();
    const listener = new MessageListener();

    // Capture the handler that attach() registers
    let capturedHandler: ((driverId: string, message: DriverMessage) => void) | null = null;
    (wsClient.onMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (handler: (driverId: string, message: DriverMessage) => void) => {
        capturedHandler = handler;
      },
    );

    listener.attach(wsClient);
    expect(capturedHandler).not.toBeNull();

    // Simulate an incoming message via the captured handler
    const msg = makeDriverMessage({ messageId: "ws-msg-1", driverId: "driver@test.com" });
    capturedHandler!("driver@test.com", msg);

    expect(listener.pendingCount).toBe(1);
    expect(listener.getUnprocessedMessages()[0].messageId).toBe("ws-msg-1");
  });
});
