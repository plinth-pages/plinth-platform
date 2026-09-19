"use client";

import type { PortfolioSummary } from "@plinth-pages/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useOperations } from "@/lib/useOperations";
import { usePublish } from "@/lib/usePublish";
import { usePreview, type PreviewPhase } from "@/lib/usePreview";
import { Brand } from "@/components/ui/Brand";
import { CodeView, type CodeTarget } from "./CodeView";
import { useToast } from "@/components/ui/Toast";
import { CopilotChat } from "./CopilotChat";
import { DeploymentToast } from "./DeploymentToast";
import { OutcomeToast } from "./OutcomeToast";
import { PublishButton } from "./PublishButton";
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
        if (e instanceof ApiError && e.status === 401) router.replace("/login");
        else setError(e instanceof Error ? e.message : "Could not open this portfolio");
      });
  }, [portfolioId, router]);

  if (error) return <Message title="Can't open the editor" detail={error} />;
  if (!portfolio) return <Message title="Opening the editor…" />;
  if (portfolio.status !== "ready") {
    return <Message title="Your portfolio is still being set up" detail="The editor opens as soon as it's ready." />;
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
  const { preview, phase, error, liveGeneration, reloadFrame, restart, rebuild } = usePreview(portfolio.id);
  const operations = useOperations(portfolio.id);
  const publishing = usePublish(portfolio.id);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    api.me().then(({ user }) => setIsAdmin(user.role === "admin"), () => undefined);
  }, []);

  // A reverted change may have left an error state inside the page's own JavaScript; start it fresh.
  const outcomeStatus = operations.outcome?.operation.status;
  const outcomeKey = operations.outcome?.key;
  useEffect(() => {
    if (outcomeStatus === "reverted") reloadFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeKey]);
  const [tab, setTab] = useState<Tab>("preview");
  const [device, setDevice] = useState<Device>("desktop");
  const [panel, setPanel] = useState<SidePanel>("integrations");
  const [codeTarget, setCodeTarget] = useState<CodeTarget | null>(null);
  const [initialPrompt, setInitialPrompt] = useState("");

  const toast = useToast();

  // Deep links: ?tab=code&file=app/page.tsx. The file is still subject to the backend's refusal rules.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("welcome")) {
      toast("Your portfolio is ready. Ask Plinth AI for anything you'd like to change.", "success");
      const url = new URL(window.location.href);
      url.searchParams.delete("welcome");
      window.history.replaceState(null, "", url);
    }
    const prompt = params.get("prompt");
    if (prompt) {
      setInitialPrompt(prompt.slice(0, 2000));
      const url = new URL(window.location.href);
      url.searchParams.delete("prompt");
      window.history.replaceState(null, "", url);
    }
    const file = params.get("file");
    if (file) setCodeTarget({ path: file });
    if (params.get("tab") === "code" || file) setTab("code");
  }, [toast]);

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
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-stone-200 bg-white px-4 dark:border-stone-800 dark:bg-stone-950">
        <div className="flex min-w-0 items-center gap-3">
          <Brand />
          <span aria-hidden className="h-5 w-px bg-stone-200 dark:bg-stone-800" />
          <Link href="/dashboard" className="truncate rounded-md px-1.5 py-1 text-sm text-stone-600 hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100">
            {portfolioTitle(portfolio.role)}
          </Link>
          <StatusChip phase={phase} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {error && isAdmin ? <span className="max-w-64 truncate text-xs text-red-700 dark:text-red-300">{error}</span> : null}
          {tab === "preview" ? (
            <div role="radiogroup" aria-label="Device width" className="hidden rounded-lg bg-stone-100 p-0.5 md:flex dark:bg-stone-900">
              {DEVICES.map((d) => (
                <button
                  key={d.id}
                  role="radio"
                  aria-checked={device === d.id}
                  onClick={() => setDevice(d.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none ${
                    device === d.id ? "bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100" : "text-stone-500 hover:text-stone-800 dark:hover:text-stone-300"
                  }`}
                >
                  {d.label.split(" ")[0]}
                </button>
              ))}
            </div>
          ) : null}
          {preview?.previewUrl && phase === "live" ? (
            <a
              href={preview.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the preview in a new tab"
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:text-stone-400 dark:hover:bg-stone-900"
            >
              Preview ↗
            </a>
          ) : null}
          <PublishButton
            status={publishing.status}
            publishing={publishing.publishing}
            deploying={publishing.deploying}
            onPublish={() => void publishing.publish()}
            error={publishing.error}
          />
        </div>
      </header>

      <div
        className={`grid min-h-0 flex-1 ${
          panel === "integrations" ? "grid-cols-[minmax(0,1fr)_340px] lg:grid-cols-[340px_minmax(0,1fr)_360px]" : "grid-cols-[minmax(0,1fr)_300px] lg:grid-cols-[340px_minmax(0,1fr)_320px]"
        }`}
      >
        <CopilotChat portfolioId={portfolio.id} operations={operations.operations} live={phase === "live"} step={operations.step} initialDraft={initialPrompt} />

        <main className="flex min-h-0 flex-col">
          {isAdmin ? (
            <div className="flex h-9 shrink-0 items-end gap-4 border-b border-stone-200 bg-white px-4 dark:border-stone-800 dark:bg-stone-950">
              <div role="tablist" aria-label="Views" className="flex gap-4">
                {(["preview", "code"] as const).map((id) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => showTab(id)}
                    className={`-mb-px border-b-2 pb-2 text-xs font-medium capitalize focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none ${
                      tab === id ? "border-stone-900 text-stone-900 dark:border-stone-100 dark:text-stone-100" : "border-transparent text-stone-500 hover:text-stone-800 dark:hover:text-stone-300"
                    }`}
                  >
                    {id}
                  </button>
                ))}
              </div>
              <span className="mb-2 ml-auto rounded bg-brand-50 px-1.5 text-[10px] font-semibold text-brand-700 uppercase dark:bg-brand-950 dark:text-brand-300">Admin</span>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 bg-white dark:bg-stone-950">
            {tab === "preview" || !isAdmin ? (
              <PreviewFrame
                url={preview?.previewUrl ?? null}
                phase={phase}
                device={device}
                generation={liveGeneration}
                working={operations.working ? workingLabel(operations.active) : null}
              />
            ) : (
              <CodeView portfolioId={portfolio.id} live={phase === "live"} target={codeTarget} onOpen={openCode} revision={operations.revision} />
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
          operations={operations.operations}
          timings={operations.timings}
          isAdmin={isAdmin}
          working={operations.working}
          revision={operations.revision}
          activeOperationId={operations.active?.id ?? null}
        />
      </div>
      <OutcomeToast outcome={operations.outcome} onDismiss={operations.dismissOutcome} />
      <DeploymentToast deployment={publishing.deployed} onDismiss={publishing.dismissDeployed} />
    </div>
  );
}

function workingLabel(operation: { status: string; type: string } | null): string {
  const copilot = operation?.type === "copilot";
  switch (operation?.status) {
    case "queued":
      return "Getting ready";
    case "staging":
      return copilot ? "Plinth AI is making your change" : "Preparing your change";
    case "checking":
      return "Making sure nothing breaks";
    case "applying":
      return "Updating your preview";
    default:
      return "Finishing up";
  }
}

const ROLE_TITLES: Record<string, string> = {
  developer: "Developer",
  designer: "Designer",
  student: "Student",
  creator: "Creator",
  freelancer: "Freelancer",
  founder: "Founder",
  researcher: "Researcher",
};

function portfolioTitle(role: string) {
  return `${ROLE_TITLES[role] ?? "My"} portfolio`;
}

const CHIP: Record<PreviewPhase, { label: string; dot: string }> = {
  loading: { label: "Connecting", dot: "bg-stone-400" },
  starting: { label: "Starting", dot: "bg-amber-500 animate-pulse motion-reduce:animate-none" },
  waking: { label: "Waking", dot: "bg-amber-500 animate-pulse motion-reduce:animate-none" },
  live: { label: "Preview ready", dot: "bg-emerald-500" },
  paused: { label: "Paused", dot: "bg-sky-500" },
  stopped: { label: "Stopped", dot: "bg-stone-400" },
  unhealthy: { label: "Needs attention", dot: "bg-red-500" },
};

function StatusChip({ phase }: { phase: PreviewPhase }) {
  return (
    <span role="status" className="hidden items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-600 sm:flex dark:bg-stone-900 dark:text-stone-400">
      <span className={`h-1.5 w-1.5 rounded-full ${CHIP[phase].dot}`} />
      {CHIP[phase].label}
    </span>
  );
}

function Message({ title, detail }: { title: string; detail?: string }) {
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="font-medium">{title}</p>
      {detail ? <p className="text-sm text-stone-500">{detail}</p> : null}
    </main>
  );
}
