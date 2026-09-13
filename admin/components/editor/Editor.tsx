"use client";

import type { PortfolioSummary } from "@plinth-pages/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { usePreview, type PreviewPhase } from "@/lib/usePreview";
import { CodeView, type CodeTarget } from "./CodeView";
import { DEVICES, PreviewFrame, type Device } from "./PreviewFrame";
import { SidePanels, type SidePanel } from "./SidePanels";

type Tab = "preview" | "code";

export function Editor({ portfolioId }: { portfolioId: string }) {
  const router = useRouter();
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .portfolio(portfolioId)
      .then(({ portfolio }) => setPortfolio(portfolio))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) router.replace("/");
        else setError(e instanceof Error ? e.message : "Could not open this portfolio");
      });
  }, [portfolioId, router]);

  if (error) return <Message title="Can't open the editor" detail={error} />;
  if (!portfolio) return <Message title="Opening the editor…" />;
  if (portfolio.status !== "ready") {
    return <Message title="Your repository is still being set up" detail="The editor opens once it's ready." />;
  }
  return (
    <WideEnough fallback={<Message title="Use a larger screen to edit" detail="The editor needs at least a tablet-sized window." />}>
      <EditorShell portfolio={portfolio} />
    </WideEnough>
  );
}

/** Below tablet width the editor is not mounted at all, so a phone never keeps a sandbox awake with heartbeats. */
function WideEnough({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    setWide(query.matches);
    const listener = (event: MediaQueryListEvent) => setWide(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  if (wide === null) return null;
  return <>{wide ? children : fallback}</>;
}

function EditorShell({ portfolio }: { portfolio: PortfolioSummary }) {
  const { preview, phase, error, liveGeneration, restart, rebuild } = usePreview(portfolio.id);
  const [tab, setTab] = useState<Tab>("preview");
  const [device, setDevice] = useState<Device>("desktop");
  const [panel, setPanel] = useState<SidePanel>("slots");
  const [codeTarget, setCodeTarget] = useState<CodeTarget | null>(null);

  // Deep links: ?tab=code&file=app/page.tsx. The file is still subject to the backend's refusal rules.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const file = params.get("file");
    if (file) setCodeTarget({ path: file });
    if (params.get("tab") === "code" || file) setTab("code");
  }, []);

  const openCode = useCallback((target: CodeTarget) => {
    setCodeTarget(target);
    setTab("code");
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "code");
    url.searchParams.set("file", target.path);
    window.history.replaceState(null, "", url);
  }, []);

  const showTab = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    if (next === "preview") url.searchParams.delete("file");
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/dashboard" className="rounded px-1.5 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none dark:hover:bg-zinc-900 dark:hover:text-zinc-100">
            ← Dashboard
          </Link>
          <span className="truncate font-mono text-sm">{portfolio.repoName}</span>
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">draft</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {error ? <span className="max-w-64 truncate text-xs text-red-700 dark:text-red-300">{error}</span> : null}
          <StatusChip phase={phase} />
          {phase === "live" || phase === "unhealthy" ? (
            <button onClick={() => void restart()} className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none dark:border-zinc-700 dark:hover:bg-zinc-900">
              Restart
            </button>
          ) : null}
          {preview?.previewUrl && phase === "live" ? (
            <a
              href={preview.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Open preview ↗
            </a>
          ) : null}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] lg:grid-cols-[260px_minmax(0,1fr)_300px]">
        <CopilotColumn />

        <main className="flex min-h-0 flex-col">
          <div className="flex h-10 shrink-0 items-end justify-between gap-4 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div role="tablist" aria-label="Views" className="flex gap-4">
              {(["preview", "code"] as const).map((id) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => showTab(id)}
                  className={`-mb-px border-b-2 pb-2 text-xs font-medium capitalize focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none ${
                    tab === id ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                  }`}
                >
                  {id}
                </button>
              ))}
            </div>
            {tab === "preview" ? (
              <div role="radiogroup" aria-label="Device width" className="mb-1.5 flex rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-900">
                {DEVICES.map((d) => (
                  <button
                    key={d.id}
                    role="radio"
                    aria-checked={device === d.id}
                    onClick={() => setDevice(d.id)}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none ${
                      device === d.id ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 bg-white dark:bg-zinc-950">
            {tab === "preview" ? (
              <PreviewFrame url={preview?.previewUrl ?? null} phase={phase} device={device} generation={liveGeneration} />
            ) : (
              <CodeView portfolioId={portfolio.id} live={phase === "live"} target={codeTarget} onOpen={openCode} />
            )}
          </div>
        </main>

        <SidePanels
          portfolio={portfolio}
          preview={preview}
          phase={phase}
          panel={panel}
          onPanel={setPanel}
          onOpenCode={openCode}
          onRestart={() => void restart()}
          onRebuild={() => void rebuild()}
        />
      </div>
    </div>
  );
}

function CopilotColumn() {
  return (
    <aside className="hidden min-h-0 flex-col border-r border-zinc-200 bg-white lg:flex dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex h-10 shrink-0 items-end border-b border-zinc-200 px-4 pb-2 dark:border-zinc-800">
        <span className="text-xs font-medium">Co-pilot</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 p-4">
        <p className="text-xs text-zinc-500">
          Describe a change — “make the hero bolder”, “add my LeetCode stats” — and the co-pilot edits your code. Every
          edit is type-checked first and undone if it breaks the build.
        </p>
        <textarea
          disabled
          rows={3}
          placeholder="The co-pilot isn't available yet"
          className="resize-none rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs placeholder:text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
        />
      </div>
    </aside>
  );
}

const CHIP: Record<PreviewPhase, { label: string; dot: string }> = {
  loading: { label: "Connecting", dot: "bg-zinc-400" },
  starting: { label: "Starting", dot: "bg-amber-500 animate-pulse motion-reduce:animate-none" },
  waking: { label: "Waking", dot: "bg-amber-500 animate-pulse motion-reduce:animate-none" },
  live: { label: "Live", dot: "bg-emerald-500" },
  paused: { label: "Paused", dot: "bg-sky-500" },
  stopped: { label: "Stopped", dot: "bg-zinc-400" },
  unhealthy: { label: "Needs attention", dot: "bg-red-500" },
};

function StatusChip({ phase }: { phase: PreviewPhase }) {
  return (
    <span role="status" className="flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-0.5 text-xs dark:border-zinc-800">
      <span className={`h-1.5 w-1.5 rounded-full ${CHIP[phase].dot}`} />
      {CHIP[phase].label}
    </span>
  );
}

function Message({ title, detail }: { title: string; detail?: string }) {
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="font-medium">{title}</p>
      {detail ? <p className="text-sm text-zinc-500">{detail}</p> : null}
    </main>
  );
}
