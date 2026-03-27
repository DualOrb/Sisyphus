import { useState, useRef, useEffect, useCallback } from "react";
import { useSSEListener, type SSEEvent } from "../api/use-sse";
import { StatusBadge } from "../components/StatusBadge";

const MAX_EVENTS = 200;

export function EventFeedPage() {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useSSEListener(
    useCallback((event: SSEEvent) => {
      setEvents((prev) => {
        const next = [event, ...prev];
        if (next.length > MAX_EVENTS) next.length = MAX_EVENTS;
        return next;
      });
    }, []),
  );

  // Auto-scroll to top when not paused
  useEffect(() => {
    if (!paused && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [events, paused]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Event Feed</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{events.length} events</span>
          <button
            onClick={() => setPaused(!paused)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              paused
                ? "bg-yellow-900 text-yellow-300"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {paused ? "Paused" : "Pause"}
          </button>
          <button
            onClick={() => setEvents([])}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-gray-500 hover:text-gray-300 hover:bg-gray-800"
          >
            Clear
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-500">Waiting for events...</p>
          <p className="text-xs text-gray-600 mt-1">
            Events will appear here as they arrive via SSE
          </p>
        </div>
      ) : (
        <div ref={containerRef} className="space-y-2 max-h-[calc(100vh-12rem)] overflow-auto">
          {events.map((event, i) => (
            <EventCard key={`${event.timestamp.getTime()}-${i}`} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({ event }: { event: SSEEvent }) {
  const time = event.timestamp.toLocaleTimeString();

  const priority =
    event.type === "audit"
      ? event.data.outcome === "rejected"
        ? "high"
        : "normal"
      : event.type === "cycle"
        ? event.data.graphInvoked
          ? "normal"
          : "low"
        : "low";

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 flex items-start gap-3">
      <span className="text-xs text-gray-600 font-mono min-w-[70px] pt-0.5">
        {time}
      </span>
      <StatusBadge value={event.type} />
      <div className="flex-1 text-sm text-gray-300">
        {event.type === "sync" && (
          <span>
            Synced: {event.data.orders} orders, {event.data.drivers} drivers,{" "}
            {event.data.tickets} tickets
          </span>
        )}
        {event.type === "cycle" && (
          <span>
            Cycle #{event.data.cycleNumber}: {event.data.reason}
            {event.data.graphInvoked && ` (${event.data.changesDetected} changes, ${event.data.eventsProcessed} events)`}
            {event.data.duration && (
              <span className="text-gray-500"> {(event.data.duration / 1000).toFixed(1)}s</span>
            )}
          </span>
        )}
        {event.type === "audit" && (
          <span>
            <span className="font-medium">{event.data.actionType}</span>
            {" "}&rarr;{" "}
            <StatusBadge value={event.data.outcome} />
            {event.data.entityId && (
              <span className="text-gray-500 text-xs ml-2">
                {event.data.entityId}
              </span>
            )}
          </span>
        )}
      </div>
      <StatusBadge value={priority} />
    </div>
  );
}
