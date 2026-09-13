"use client";

import type {
  ContractCheckResponse,
  OperationStatus,
  OperationSummary,
  OperationTimings,
  PortfolioSummary,
  PreviewSummary,
  SlotInfo,
  SlotsResponse,
} from "@plinth-pages/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { PreviewPhase } from "@/lib/usePreview";
import type { CodeTarget } from "./CodeView";
import { SafetyNetTester } from "./SafetyNetTester";

export type SidePanel = "slots" | "integrations" | "settings";

const PANELS: { id: SidePanel; label: string }[] = [
  { id: "slots", label: "Slots" },
  { id: "integrations", label: "Integrations" },
  { id: "settings", label: "Settings" },
];

export function SidePanels(props: {
  portfolio: PortfolioSummary;
  preview: PreviewSummary | null;
  phase: PreviewPhase;
  panel: SidePanel;
  onPanel: (panel: SidePanel) => void;
  onOpenCode: (target: CodeTarget) => void;
  onRestart: () => void;
  onRebuild: () => void;
  operations: OperationSummary[];
  timings: OperationTimings | null;
  isAdmin: boolean;
  working: boolean;
}) {
  return (
    <aside className="flex min-h-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div role="tablist" aria-label="Panels" className="flex h-10 shrink-0 items-end gap-4 border-b border-zinc-200 px-4 dark:border-zinc-800">
        {PANELS.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={props.panel === id}
            onClick={() => props.onPanel(id)}
            className={`-mb-px border-b-2 pb-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${
              props.panel === id
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {props.panel === "slots" ? (
          <SlotsPanel portfolioId={props.portfolio.id} live={props.phase === "live"} onOpenCode={props.onOpenCode} />
        ) : null}
        {props.panel === "integrations" ? <IntegrationsPanel onShowSlots={() => props.onPanel("slots")} /> : null}
        {props.panel === "settings" ? (
          <SettingsPanel
            portfolio={props.portfolio}
            preview={props.preview}
            phase={props.phase}
            onRestart={props.onRestart}
            onRebuild={props.onRebuild}
            operations={props.operations}
            timings={props.timings}
            isAdmin={props.isAdmin}
            working={props.working}
          />
        ) : null}
      </div>
    </aside>
  );
}

/**
 * The slot contract as the portfolio actually has it: every place an integration can be injected, what is placed there
 * today, and a check that the markers the codemod engine depends on are intact.
 */
function SlotsPanel({ portfolioId, live, onOpenCode }: { portfolioId: string; live: boolean; onOpenCode: (target: CodeTarget) => void }) {
  const [slots, setSlots] = useState<SlotsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<ContractCheckResponse | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      setSlots(await api.slots(portfolioId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the slots");
    }
  }, [portfolioId]);

  useEffect(() => {
    if (live) void load();
  }, [live, load]);

  async function runCheck() {
    setChecking(true);
    try {
      setCheck(await api.checkContract(portfolioId));
    } catch (e) {
      setCheck({ ok: false, issues: [{ code: "CHECK_FAILED", message: e instanceof Error ? e.message : "The check did not run" }], durationMs: 0 });
    } finally {
      setChecking(false);
    }
  }

  if (!live) return <PanelNote>Slots are read from your running preview.</PanelNote>;
  if (error) return <PanelNote tone="error">{error}</PanelNote>;
  if (!slots) return <PanelNote>Reading the slot contract…</PanelNote>;

  const byFile = Object.entries(
    slots.slots.reduce<Record<string, SlotInfo[]>>((groups, slot) => ((groups[slot.file] ??= []).push(slot), groups), {}),
  );

  return (
    <div className="flex flex-col gap-5 p-4">
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Integrations are injected into these slots. Everything else in your code stays yours to change.
        <span className="mt-1 block font-mono text-[11px] text-zinc-500">
          @plinth-pages/core {slots.coreVersion ?? "?"} · slots v{slots.slotsVersion ?? "?"}
        </span>
      </p>

      {byFile.map(([file, fileSlots]) => (
        <section key={file} className="flex flex-col gap-1">
          <h3 className="font-mono text-[11px] text-zinc-500">{file}</h3>
          <ul className="flex flex-col">
            {fileSlots.map((slot) => (
              <li key={slot.name}>
                <button
                  onClick={() => onOpenCode({ path: slot.file, find: `name="${slot.name}"` })}
                  className="group flex w-full items-start justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none dark:hover:bg-zinc-900"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-[12.5px] text-zinc-900 dark:text-zinc-100">{slot.name}</span>
                    <span className="block text-xs text-zinc-500">{slot.description}</span>
                  </span>
                  <span className="shrink-0 pt-0.5 text-[11px] text-zinc-500">
                    {slot.integrations.length ? `${slot.integrations.length} placed` : "empty"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium">Contract check</h3>
          <button
            onClick={() => void runCheck()}
            disabled={checking}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {checking ? "Checking…" : "Run plinth check"}
          </button>
        </div>
        {check ? (
          check.ok ? (
            <p className="text-xs text-emerald-800 dark:text-emerald-300">
              ✓ All {slots.slots.length} slots and markers are intact ({(check.durationMs / 1000).toFixed(1)} s).
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {check.issues.map((issue, index) => (
                <li key={index} className="rounded-md bg-red-50 p-2 text-xs text-red-900 dark:bg-red-950 dark:text-red-200">
                  <span className="font-mono text-[11px]">
                    {issue.code}
                    {issue.file ? ` · ${issue.file}${issue.line ? `:${issue.line}` : ""}` : ""}
                  </span>
                  <span className="mt-0.5 block">{issue.message}</span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="text-xs text-zinc-500">Validates that every slot and codemod marker is where the engine expects it.</p>
        )}
      </section>
    </div>
  );
}

function IntegrationsPanel({ onShowSlots }: { onShowSlots: () => void }) {
  return (
    <div className="flex flex-col gap-3 p-4 text-xs text-zinc-600 dark:text-zinc-400">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">No integrations installed</p>
      <p>
        Installing an integration adds its package, imports it, and places it in a slot — as a code change that is
        type-checked before it reaches your preview, and undone if it breaks the build.
      </p>
      <p>The catalogue opens once that safety net is in place. Your slots are ready for it.</p>
      <button
        onClick={onShowSlots}
        className="w-fit rounded-md border border-zinc-300 px-2.5 py-1 font-medium text-zinc-800 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
      >
        See the slots
      </button>
    </div>
  );
}

function SettingsPanel({
  portfolio,
  preview,
  phase,
  onRestart,
  onRebuild,
  operations,
  timings,
  isAdmin,
  working,
}: {
  portfolio: PortfolioSummary;
  preview: PreviewSummary | null;
  phase: PreviewPhase;
  onRestart: () => void;
  onRebuild: () => void;
  operations: OperationSummary[];
  timings: OperationTimings | null;
  isAdmin: boolean;
  working: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const running = preview?.runStartedAt ? Math.max(0, (Date.now() - Date.parse(preview.runStartedAt)) / 1000) : 0;
  const minutes = preview ? Math.round((preview.secondsUsed + running) / 60) : 0;

  return (
    <div className="flex flex-col gap-5 p-4 text-xs">
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Preview</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-zinc-600 tabular-nums dark:text-zinc-400">
          <dt>Branch</dt>
          <dd className="font-mono">draft</dd>
          <dt>Pauses after</dt>
          <dd>{preview ? `${Math.round(preview.idlePauseSeconds / 60)} min away` : "—"}</dd>
          <dt>Sandbox time</dt>
          <dd>{minutes < 1 ? "under a minute" : `${minutes} min`}</dd>
          <dt>Cold start</dt>
          <dd>{preview?.coldStartMs ? `${(preview.coldStartMs / 1000).toFixed(1)} s` : "—"}</dd>
          <dt>Last resume</dt>
          <dd>{preview?.resumeMs ? `${(preview.resumeMs / 1000).toFixed(1)} s` : "—"}</dd>
          <dt>Link expires</dt>
          <dd>15 min after you leave</dd>
        </dl>
        {phase === "unhealthy" && preview?.lastError ? (
          <pre className="max-h-48 overflow-auto rounded-md bg-red-50 p-2 font-mono text-[11px] whitespace-pre-wrap text-red-900 dark:bg-red-950 dark:text-red-200">
            {preview.lastError}
          </pre>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Recent changes</h3>
        {operations.length === 0 ? <p className="text-zinc-500">No changes yet.</p> : null}
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
          {operations.slice(0, 8).map((operation) => (
            <li key={operation.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate" title={operation.summary}>
                {operation.summary}
              </span>
              <span className="flex shrink-0 items-center gap-2 tabular-nums">
                {operation.checkMs ? <span className="text-[11px] text-zinc-500">{(operation.checkMs / 1000).toFixed(1)} s</span> : null}
                <OperationBadge status={operation.status} />
              </span>
            </li>
          ))}
        </ul>
        {timings?.sampleSize ? (
          <p className="text-[11px] text-zinc-500 tabular-nums">
            Checks p50 {seconds(timings.checkP50Ms)} · p95 {seconds(timings.checkP95Ms)} · end to end p50 {seconds(timings.totalP50Ms)} (last{" "}
            {timings.sampleSize})
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Repository</h3>
        {portfolio.repoUrl ? (
          <a href={portfolio.repoUrl} target="_blank" rel="noopener noreferrer" className="w-fit font-mono underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-600">
            {portfolio.repoName} ↗
          </a>
        ) : null}
      </section>

      <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <h3 className="font-medium">Troubleshooting</h3>
        <p className="text-zinc-500">Restart reloads Next.js in the same sandbox. Rebuild starts a fresh sandbox from your draft branch.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={onRestart} className="rounded-md border border-zinc-300 px-2.5 py-1 font-medium hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none dark:border-zinc-700 dark:hover:bg-zinc-900">
            Restart
          </button>
          {confirming ? (
            <>
              <button
                onClick={() => (setConfirming(false), onRebuild())}
                className="rounded-md bg-red-700 px-2.5 py-1 font-medium text-white hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none"
              >
                Rebuild from draft
              </button>
              <button onClick={() => setConfirming(false)} className="rounded-md px-2.5 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900">
                Cancel
              </button>
            </>
          ) : (
            <button onClick={() => setConfirming(true)} className="rounded-md border border-zinc-300 px-2.5 py-1 font-medium hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none dark:border-zinc-700 dark:hover:bg-zinc-900">
              Rebuild…
            </button>
          )}
        </div>
      </section>

      {isAdmin ? <SafetyNetTester portfolioId={portfolio.id} disabled={phase !== "live" || working} /> : null}
    </div>
  );
}

const BADGE: Record<OperationStatus, { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  staging: { label: "Preparing", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  checking: { label: "Checking", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  applying: { label: "Applying", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  applied: { label: "Applied", tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  rejected: { label: "Not applied", tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  reverted: { label: "Undone", tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  failed: { label: "Failed", tone: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
};

function OperationBadge({ status }: { status: OperationStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE[status].tone}`}>{BADGE[status].label}</span>;
}

function seconds(ms: number | null) {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`;
}

function PanelNote({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return <p className={`p-4 text-xs ${tone === "error" ? "text-red-800 dark:text-red-300" : "text-zinc-500"}`}>{children}</p>;
}
