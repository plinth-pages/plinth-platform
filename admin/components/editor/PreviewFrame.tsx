"use client";

import { useEffect, useRef, useState } from "react";
import type { PreviewPhase } from "@/lib/usePreview";

export type Device = "desktop" | "tablet" | "mobile";

export const DEVICES: { id: Device; label: string; width: number | null }[] = [
  { id: "desktop", label: "Desktop", width: null },
  { id: "tablet", label: "Tablet · 768", width: 768 },
  { id: "mobile", label: "Mobile · 390", width: 390 },
];

const PHASE_MESSAGE: Record<Exclude<PreviewPhase, "live">, { title: string; detail: string }> = {
  loading: { title: "Opening your preview…", detail: "" },
  starting: {
    title: "Starting your preview…",
    detail: "Getting your site ready to edit. This usually takes under 30 seconds.",
  },
  waking: { title: "Waking your preview…", detail: "It paused while you were away. This takes a second or two." },
  paused: { title: "Paused", detail: "It resumes as soon as you're back on this tab." },
  stopped: { title: "Starting your preview…", detail: "It was stopped after a long break and is being restarted with all your changes." },
  unhealthy: { title: "The preview couldn't start", detail: "See Settings for the error, then restart or rebuild." },
};

/**
 * The live draft. Device widths change the iframe's real width, so the portfolio's own CSS breakpoints fire; when the
 * device is wider than the space available, the frame is scaled down rather than squeezed.
 */
export function PreviewFrame({
  url,
  phase,
  device,
  generation,
  working,
}: {
  url: string | null;
  phase: PreviewPhase;
  device: Device;
  generation: number;
  /** A change is being checked or applied: the frame is blurred and covered, so a half-applied state is never seen. */
  working: string | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    // Measure now as well: ResizeObserver only reports on a rendered frame, which a background tab may not get.
    const rect = element.getBoundingClientRect();
    setBox({ width: rect.width, height: rect.height });
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const deviceWidth = DEVICES.find((d) => d.id === device)?.width ?? null;
  const gutter = deviceWidth ? 32 : 0;
  const width = deviceWidth ?? box.width;
  const scale = deviceWidth && box.width > 0 ? Math.min(1, (box.width - gutter) / deviceWidth) : 1;
  const available = Math.max(0, box.height - gutter);
  const height = scale < 1 ? available / scale : available;

  return (
    <div ref={container} className="relative h-full w-full overflow-hidden bg-stone-100 dark:bg-stone-900">
      {url && phase === "live" ? (
        <div
          className={`${deviceWidth ? "absolute top-4 left-1/2 origin-top" : "absolute inset-0"} transition-[filter] duration-300 motion-reduce:transition-none ${
            working ? "pointer-events-none blur-md saturate-50 select-none" : ""
          }`}
          style={deviceWidth ? { width, height, transform: `translateX(-50%) scale(${scale})` } : undefined}
          aria-hidden={working ? true : undefined}
        >
          <iframe
            key={generation}
            src={url}
            title="Portfolio preview"
            className={`h-full w-full bg-white ${deviceWidth ? "rounded-lg shadow-sm ring-1 ring-stone-300 dark:ring-stone-700" : ""}`}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        </div>
      ) : null}

      {phase !== "live" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
          <span
            className={`h-2 w-2 rounded-full ${phase === "unhealthy" ? "bg-red-500" : "animate-pulse bg-amber-500 motion-reduce:animate-none"}`}
          />
          <p className="text-sm font-medium">{PHASE_MESSAGE[phase].title}</p>
          {PHASE_MESSAGE[phase].detail ? <p className="max-w-sm text-xs text-stone-500">{PHASE_MESSAGE[phase].detail}</p> : null}
        </div>
      ) : null}

      {working && phase === "live" ? (
        <div role="status" aria-live="polite" className="absolute inset-0 flex items-center justify-center bg-white/30 dark:bg-stone-950/30">
          <div className="flex items-center gap-3 rounded-full bg-white/95 py-2 pr-5 pl-3 shadow-lg ring-1 ring-stone-200 dark:bg-stone-900/95 dark:ring-stone-700">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-900 motion-reduce:animate-none dark:border-stone-600 dark:border-t-stone-100" />
            <span className="flex flex-col">
              <span className="text-sm font-medium">Working on it…</span>
              <span className="text-xs text-stone-500">{working}</span>
            </span>
          </div>
        </div>
      ) : null}

      {deviceWidth && scale < 1 && phase === "live" ? (
        <p className="absolute right-3 bottom-2 font-mono text-[11px] text-stone-500 tabular-nums">
          {deviceWidth}px shown at {Math.round(scale * 100)}%
        </p>
      ) : null}
    </div>
  );
}
