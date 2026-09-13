"use client";

import type { PreviewSummary } from "@plinth-pages/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { usePortfolioEvents } from "./portfolioEvents";

const HEARTBEAT_MS = 30_000;
/** Fallback polling. Live events normally make this redundant; it covers a dropped event stream. */
const BUSY_POLL_MS = 3_000;
const IDLE_POLL_MS = 20_000;

export type PreviewPhase = "loading" | "starting" | "waking" | "live" | "paused" | "stopped" | "unhealthy";

export function phaseOf(preview: PreviewSummary | null): PreviewPhase {
  if (!preview) return "loading";
  if (preview.status === "unhealthy" && !preview.pending) return "unhealthy";
  if (preview.status === "running") return preview.pending ? "starting" : "live";
  if (preview.status === "paused") return preview.pending ? "waking" : "paused";
  if (preview.status === "starting" || preview.pending) return "starting";
  return "stopped";
}

/**
 * Keeps a portfolio's preview awake while the editor is visible: opens it, sends a heartbeat every 30 seconds, and
 * listens for sandbox events so the status updates the moment the worker changes it.
 */
export function usePreview(portfolioId: string) {
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped whenever the preview becomes live again, so the frame reloads instead of showing a stale error page. */
  const [liveGeneration, setLiveGeneration] = useState(0);
  const wasLive = useRef(false);

  const apply = useCallback((next: PreviewSummary) => {
    const live = phaseOf(next) === "live";
    if (live && !wasLive.current) setLiveGeneration((n) => n + 1);
    wasLive.current = live;
    setPreview(next);
    setError(null);
  }, []);

  const run = useCallback(
    async (call: () => Promise<{ preview: PreviewSummary }>) => {
      try {
        apply((await call()).preview);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not reach Plinth");
      }
    },
    [apply],
  );

  const refresh = useCallback(() => run(() => api.preview(portfolioId)), [portfolioId, run]);

  // Show the current state straight away, even in a tab opened in the background (which sends no heartbeat).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Heartbeat while the tab is visible; coming back to the tab wakes a paused preview straight away.
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === "visible") void run(() => api.openPreview(portfolioId));
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [portfolioId, run]);

  usePortfolioEvents(portfolioId, (event) => {
    if (event.type === "sandbox") void refresh();
  });

  const phase = phaseOf(preview);
  // Paused or stopped while someone is looking (the provider paused it, or a sweep did): wake it now rather than at
  // the next heartbeat.
  useEffect(() => {
    if ((phase === "paused" || phase === "stopped") && document.visibilityState === "visible") {
      void run(() => api.openPreview(portfolioId));
    }
  }, [phase, portfolioId, run]);

  const busy = phase === "starting" || phase === "waking";
  useEffect(() => {
    const timer = setInterval(() => void refresh(), busy ? BUSY_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [busy, refresh]);

  return {
    preview,
    phase,
    error,
    liveGeneration,
    /** Reloads the frame, e.g. after a change was reverted, so no stale error state survives in the page. */
    reloadFrame: () => setLiveGeneration((n) => n + 1),
    restart: () => run(() => api.restartPreview(portfolioId)),
    rebuild: () => run(() => api.rebuildPreview(portfolioId)),
  };
}
