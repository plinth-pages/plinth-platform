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
    detail: "Cloning the draft branch, installing packages and starting Next.js. Usually under 30 seconds.",
  },
  waking: { title: "Waking your preview…", detail: "It paused while you were away. This takes a second or two." },
  paused: { title: "Paused", detail: "It resumes as soon as you're back on this tab." },
  stopped: { title: "Starting your preview…", detail: "It was stopped after a long break and is being rebuilt from your draft." },
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
}: {
  url: string | null;
  phase: PreviewPhase;
  device: Device;
  generation: number;
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
    <div ref={container} className="relative h-full w-full overflow-hidden bg-zinc-100 dark:bg-zinc-900">
      {url && phase === "live" ? (
        <div
          className={deviceWidth ? "absolute top-4 left-1/2 origin-top" : "absolute inset-0"}
          style={deviceWidth ? { width, height, transform: `translateX(-50%) scale(${scale})` } : undefined}
        >
          <iframe
            key={generation}
            src={url}
            title="Portfolio preview"
            className={`h-full w-full bg-white ${deviceWidth ? "rounded-lg shadow-sm ring-1 ring-zinc-300 dark:ring-zinc-700" : ""}`}
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
          {PHASE_MESSAGE[phase].detail ? <p className="max-w-sm text-xs text-zinc-500">{PHASE_MESSAGE[phase].detail}</p> : null}
        </div>
      ) : null}

      {deviceWidth && scale < 1 && phase === "live" ? (
        <p className="absolute right-3 bottom-2 font-mono text-[11px] text-zinc-500 tabular-nums">
          {deviceWidth}px shown at {Math.round(scale * 100)}%
        </p>
      ) : null}
    </div>
  );
}
