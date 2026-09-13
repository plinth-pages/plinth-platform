"use client";

import type { PortfolioEvent } from "@plinth-pages/shared";
import { useEffect, useRef } from "react";
import { api } from "./api";

type Listener = (event: PortfolioEvent) => void;

/** One EventSource per portfolio, shared by every hook on the page. Closed when the last listener leaves. */
const streams = new Map<string, { source: EventSource; listeners: Set<Listener> }>();

function subscribe(portfolioId: string, listener: Listener): () => void {
  let stream = streams.get(portfolioId);
  if (!stream) {
    const source = new EventSource(api.eventsUrl(portfolioId), { withCredentials: true });
    const listeners = new Set<Listener>();
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as PortfolioEvent | { type: "ping" };
      if (event.type === "ping") return;
      for (const l of listeners) l(event);
    };
    stream = { source, listeners };
    streams.set(portfolioId, stream);
  }
  stream.listeners.add(listener);
  return () => {
    stream.listeners.delete(listener);
    if (stream.listeners.size === 0) {
      stream.source.close();
      streams.delete(portfolioId);
    }
  };
}

export function usePortfolioEvents(portfolioId: string, onEvent: Listener) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => subscribe(portfolioId, (event) => handler.current(event)), [portfolioId]);
}
