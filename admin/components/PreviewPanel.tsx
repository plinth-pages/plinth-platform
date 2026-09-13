"use client";

import type { PreviewStatus, PreviewSummary } from "@plinth-pages/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

const HEARTBEAT_MS = 30_000;
const FAST_POLL_MS = 2_000;
const SLOW_POLL_MS = 15_000;

const STATUS: Record<PreviewStatus, { label: string; badge: string }> = {
  none: { label: "Not started", badge: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  starting: { label: "Starting", badge: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  running: { label: "Live", badge: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  paused: { label: "Paused", badge: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  destroyed: { label: "Stopped", badge: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  unhealthy: { label: "Needs attention", badge: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
};

/**
 * The live preview of a portfolio's `draft` branch. While this panel is open and the tab is visible it sends a
 * heartbeat; without one the sandbox pauses after the idle window, and the next heartbeat wakes it.
 */
export function PreviewPanel({ portfolioId }: { portfolioId: string }) {
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const lastStatus = useRef<PreviewStatus | null>(null);

  const apply = useCallback((next: PreviewSummary) => {
    // Reload the frame whenever the preview comes back, so it never keeps showing a gateway error from while it slept.
    if (next.status === "running" && lastStatus.current !== "running") setFrameKey((key) => key + 1);
    lastStatus.current = next.status;
    setPreview(next);
  }, []);

  const run = useCallback(
    async (call: () => Promise<{ preview: PreviewSummary }>) => {
      try {
        apply((await call()).preview);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not reach the preview service");
      }
    },
    [apply],
  );

  useEffect(() => {
    void run(async () => {
      const response = await api.preview(portfolioId);
      // Recently used previews reopen on their own; resuming one takes about a second.
      if (response.preview.status === "running" || response.preview.status === "paused") setActive(true);
      return response;
    });
  }, [portfolioId, run]);

  // Heartbeat: keeps the sandbox awake while someone is looking, and wakes it when they come back to the tab.
  useEffect(() => {
    if (!active) return;
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
  }, [active, portfolioId, run]);

  const busy = preview?.pending || preview?.status === "starting";
  useEffect(() => {
    const timer = setInterval(() => void run(() => api.preview(portfolioId)), busy ? FAST_POLL_MS : SLOW_POLL_MS);
    return () => clearInterval(timer);
  }, [busy, portfolioId, run]);

  if (!preview) {
    return error ? <Note tone="error">{error}</Note> : <p className="text-sm text-zinc-500">Loading preview…</p>;
  }

  const status = STATUS[preview.status];
  const live = preview.status === "running" && preview.previewUrl;
  const canStart = !active || preview.status === "unhealthy" || preview.status === "destroyed" || preview.status === "none";

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold">Preview</h3>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.badge}`}>
            {busy && preview.status !== "starting" ? "Waking…" : status.label}
          </span>
          <span className="font-mono text-xs text-zinc-500">draft</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {live ? (
            <a
              href={preview.previewUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md px-2.5 py-1 text-sm text-zinc-700 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Open in new tab ↗
            </a>
          ) : null}
          {canStart && !busy ? (
            <Button primary onClick={() => (setActive(true), run(() => api.openPreview(portfolioId)))}>
              {preview.status === "unhealthy" ? "Try again" : "Start preview"}
            </Button>
          ) : null}
          {preview.status === "running" || preview.status === "unhealthy" ? (
            <>
              <Button disabled={busy} onClick={() => (setActive(true), run(() => api.restartPreview(portfolioId)))}>
                Restart
              </Button>
              <Button disabled={busy} onClick={() => (setActive(true), run(() => api.rebuildPreview(portfolioId)))}>
                Rebuild
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <div className="aspect-[16/10] w-full bg-zinc-50 dark:bg-zinc-950">
        {live ? (
          <iframe
            key={frameKey}
            src={preview.previewUrl!}
            title="Portfolio preview"
            className="h-full w-full"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <PlaceholderText preview={preview} busy={Boolean(busy)} active={active} />
          </div>
        )}
      </div>

      <footer className="flex flex-col gap-2 border-t border-zinc-200 px-5 py-3 text-xs text-zinc-500 dark:border-zinc-800">
        {preview.status === "unhealthy" && preview.lastError ? (
          <pre className="max-h-40 overflow-auto rounded-md bg-red-50 p-3 font-mono whitespace-pre-wrap text-red-800 dark:bg-red-950 dark:text-red-200">
            {preview.lastError}
          </pre>
        ) : null}
        {error ? <Note tone="error">{error}</Note> : null}
        <p className="tabular-nums">
          Pauses after {Math.round(preview.idlePauseSeconds / 60)} min without activity · {formatUsage(preview)} used
          {preview.coldStartMs ? ` · cold start ${(preview.coldStartMs / 1000).toFixed(1)} s` : ""}
          {preview.resumeMs ? ` · last resume ${(preview.resumeMs / 1000).toFixed(1)} s` : ""}
        </p>
      </footer>
    </section>
  );
}

function PlaceholderText({ preview, busy, active }: { preview: PreviewSummary; busy: boolean; active: boolean }) {
  if (preview.status === "starting" || (busy && preview.status !== "paused")) {
    return (
      <>
        <p className="animate-pulse text-sm font-medium motion-reduce:animate-none">Starting your preview…</p>
        <p className="text-xs text-zinc-500">Cloning the draft branch, installing packages and starting Next.js. Usually under 30 seconds.</p>
      </>
    );
  }
  if (preview.status === "paused") {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">{active ? "Waking your preview…" : "Paused while you were away."}</p>;
  }
  if (preview.status === "unhealthy") {
    return <p className="text-sm text-red-800 dark:text-red-300">The preview could not start. The details are below.</p>;
  }
  return (
    <>
      <p className="text-sm font-medium">Your draft, running live</p>
      <p className="max-w-sm text-xs text-zinc-500">
        Starts a private sandbox with your repository&apos;s draft branch. It pauses when you leave and resumes when you return.
      </p>
    </>
  );
}

function formatUsage(preview: PreviewSummary): string {
  const running = preview.runStartedAt ? Math.max(0, (Date.now() - Date.parse(preview.runStartedAt)) / 1000) : 0;
  const minutes = (preview.secondsUsed + running) / 60;
  return minutes < 1 ? "under a minute" : `${Math.round(minutes)} min`;
}

function Button({ primary, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  const look = primary
    ? "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
    : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
  return (
    <button
      {...props}
      className={`rounded-md px-3 py-1 text-sm font-medium focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none disabled:opacity-50 ${look}`}
    />
  );
}

function Note({ tone, children }: { tone: "error"; children: React.ReactNode }) {
  return (
    <p
      className={
        tone === "error"
          ? "rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          : ""
      }
    >
      {children}
    </p>
  );
}
