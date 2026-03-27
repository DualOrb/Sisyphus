import { useEffect, useRef, useCallback } from "react";
import type { QueryClient } from "@tanstack/react-query";

export interface SSEEvent {
  type: string;
  data: any;
  timestamp: Date;
}

type Listener = (event: SSEEvent) => void;

const listeners = new Set<Listener>();

export function onSSEEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSSE(queryClient: QueryClient) {
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/events/stream");
    esRef.current = es;

    es.addEventListener("sync", (e) => {
      const data = JSON.parse(e.data);
      const event: SSEEvent = { type: "sync", data, timestamp: new Date() };
      listeners.forEach((fn) => fn(event));
      queryClient.invalidateQueries();
    });

    es.addEventListener("cycle", (e) => {
      const data = JSON.parse(e.data);
      const event: SSEEvent = { type: "cycle", data, timestamp: new Date() };
      listeners.forEach((fn) => fn(event));
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    });

    es.addEventListener("audit", (e) => {
      const data = JSON.parse(e.data);
      const event: SSEEvent = { type: "audit", data, timestamp: new Date() };
      listeners.forEach((fn) => fn(event));
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    });

    es.addEventListener("activity", (e) => {
      const data = JSON.parse(e.data);
      const event: SSEEvent = { type: "activity", data, timestamp: new Date() };
      listeners.forEach((fn) => fn(event));
    });

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [queryClient]);
}

export function useSSEListener(fn: Listener) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const stableFn = useCallback((e: SSEEvent) => fnRef.current(e), []);

  useEffect(() => {
    return onSSEEvent(stableFn);
  }, [stableFn]);
}
