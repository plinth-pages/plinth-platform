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
import { IntegrationsPanel } from "./IntegrationsPanel";
import { SafetyNetTester } from "./SafetyNetTester";

export type SidePanel = "slots" | "integrations" | "settings";

const PANELS: { id: SidePanel; label: string; adminOnly?: boolean }[] = [
  { id: "integrations", label: "Integrations" },
  { id: "settings", label: "Settings" },
  { id: "slots", label: "Slots", adminOnly: true },
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
  /** Increments when an operation finishes. */
  revision: number;
  activeOperationId: string | null;
}) {
  return (
    <aside className="flex min-h-0 flex-col border-l border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
      <div role="tablist" aria-label="Panels" className="flex h-11 shrink-0 items-end gap-5 border-b border-stone-200 px-4 dark:border-stone-800">
        {PANELS.filter((entry) => props.isAdmin || !entry.adminOnly).map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={props.panel === id}
            onClick={() => props.onPanel(id)}
            className={`-mb-px border-b-2 pb-2.5 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              props.panel === id
                ? "border-stone-900 text-stone-900 dark:border-stone-100 dark:text-stone-100"
                : "border-transparent text-stone-500 hover:text-stone-800 dark:hover:text-stone-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {props.panel === "slots" && props.isAdmin ? (
          <SlotsPanel portfolioId={props.portfolio.id} live={props.phase === "live"} onOpenCode={props.onOpenCode} />
        ) : null}
        {props.panel === "integrations" ? (
          <IntegrationsPanel portfolioId={props.portfolio.id} role={props.portfolio.role} revision={props.revision} activeOperationId={props.activeOperationId} />
        ) : null}
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
      <p className="text-xs text-stone-600 dark:text-stone-400">
        Integrations are injected into these slots. Everything else in your code stays yours to change.
        <span className="mt-1 block font-mono text-[11px] text-stone-500">
          @plinth-pages/core {slots.coreVersion ?? "?"} · slots v{slots.slotsVersion ?? "?"}
        </span>
      </p>

      {byFile.map(([file, fileSlots]) => (
        <section key={file} className="flex flex-col gap-1">
          <h3 className="font-mono text-[11px] text-stone-500">{file}</h3>
          <ul className="flex flex-col">
            {fileSlots.map((slot) => (
              <li key={slot.name}>
                <button
                  onClick={() => onOpenCode({ path: slot.file, find: `name="${slot.name}"` })}
                  className="group flex w-full items-start justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none dark:hover:bg-stone-900"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-[12.5px] text-stone-900 dark:text-stone-100">{slot.name}</span>
                    <span className="block text-xs text-stone-500">{slot.description}</span>
                  </span>
                  <span className="shrink-0 pt-0.5 text-[11px] text-stone-500">
                    {slot.integrations.length ? `${slot.integrations.length} placed` : "empty"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="flex flex-col gap-2 border-t border-stone-200 pt-4 dark:border-stone-800">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium">Contract check</h3>
          <button
            onClick={() => void runCheck()}
            disabled={checking}
            className="rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-900"
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
          <p className="text-xs text-stone-500">Validates that every slot and codemod marker is where the engine expects it.</p>
        )}
      </section>
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
  const history = operations.filter((operation) => isAdmin || operation.type !== "publish");

  return (
    <div className="flex flex-col gap-6 p-4 text-sm">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Change history</h3>
        {history.length === 0 ? <p className="text-stone-500">No changes yet. Ask Plinth AI or add an integration to get started.</p> : null}
        <ul className="flex flex-col divide-y divide-stone-100 dark:divide-stone-900">
          {history.slice(0, 10).map((operation) => (
            <li key={operation.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate" title={operation.summary}>
                  {operation.summary}
                </span>
                <span className="text-xs text-stone-500">
                  {operation.actor === "copilot" ? "Plinth AI" : "You"} · {new Date(operation.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              </span>
              <OperationBadge status={operation.status} />
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Preview</h3>
        <p className="text-stone-600 dark:text-stone-400">If the preview looks stuck, reload it. Resetting starts it fresh from your saved changes — nothing is lost.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={onRestart} disabled={working} className="rounded-lg px-3 py-1.5 text-[13px] font-medium ring-1 ring-stone-300 hover:bg-stone-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-50 dark:ring-stone-700 dark:hover:bg-stone-900">
            Reload preview
          </button>
          {confirming ? (
            <>
              <button onClick={() => (setConfirming(false), onRebuild())} className="rounded-lg bg-stone-900 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-stone-700 dark:bg-white dark:text-stone-900">
                Reset preview
              </button>
              <button onClick={() => setConfirming(false)} className="rounded-lg px-2.5 py-1.5 text-[13px] text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-900">
                Cancel
              </button>
            </>
          ) : (
            <button onClick={() => setConfirming(true)} disabled={working} className="rounded-lg px-3 py-1.5 text-[13px] font-medium ring-1 ring-stone-300 hover:bg-stone-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-50 dark:ring-stone-700 dark:hover:bg-stone-900">
              Reset…
            </button>
          )}
        </div>
        {phase === "unhealthy" ? <p className="text-red-800 dark:text-red-300">The preview couldn&apos;t start. Try resetting it.</p> : null}
      </section>

      {isAdmin ? (
        <section className="flex flex-col gap-3 rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800">
          <h3 className="flex items-center gap-2 text-xs font-medium tracking-wide text-stone-500 uppercase">
            Technical details <span className="rounded bg-brand-50 px-1.5 text-[10px] text-brand-700 dark:bg-brand-950 dark:text-brand-300">Admin</span>
          </h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs text-stone-600 tabular-nums dark:text-stone-400">
            <dt>Repository</dt>
            <dd className="truncate font-mono">
              {portfolio.repoUrl ? (
                <a href={portfolio.repoUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-stone-300 underline-offset-2">
                  {portfolio.repoName}
                </a>
              ) : (
                portfolio.repoName
              )}
            </dd>
            <dt>Branch</dt>
            <dd className="font-mono">draft</dd>
            <dt>Idle pause</dt>
            <dd>{preview ? `${Math.round(preview.idlePauseSeconds / 60)} min` : "—"}</dd>
            <dt>Sandbox time</dt>
            <dd>{minutes < 1 ? "under a minute" : `${minutes} min`}</dd>
            <dt>Cold start</dt>
            <dd>{preview?.coldStartMs ? `${(preview.coldStartMs / 1000).toFixed(1)} s` : "—"}</dd>
            <dt>Last resume</dt>
            <dd>{preview?.resumeMs ? `${(preview.resumeMs / 1000).toFixed(1)} s` : "—"}</dd>
            <dt>Checks</dt>
            <dd>{timings?.sampleSize ? `p50 ${seconds(timings.checkP50Ms)} · p95 ${seconds(timings.checkP95Ms)} (${timings.sampleSize})` : "—"}</dd>
          </dl>
          {phase === "unhealthy" && preview?.lastError ? (
            <pre className="max-h-48 overflow-auto rounded-md bg-red-50 p-2 font-mono text-[11px] whitespace-pre-wrap text-red-900 dark:bg-red-950 dark:text-red-200">{preview.lastError}</pre>
          ) : null}
          <SafetyNetTester portfolioId={portfolio.id} disabled={phase !== "live" || working} />
        </section>
      ) : null}
    </div>
  );
}

const BADGE: Record<OperationStatus, { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300" },
  staging: { label: "Working", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  checking: { label: "Checking", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  applying: { label: "Applying", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  applied: { label: "Done", tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  rejected: { label: "Not applied", tone: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300" },
  reverted: { label: "Undone", tone: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300" },
  failed: { label: "Failed", tone: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
};

function OperationBadge({ status }: { status: OperationStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE[status].tone}`}>{BADGE[status].label}</span>;
}

function seconds(ms: number | null) {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`;
}

function PanelNote({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return <p className={`p-4 text-xs ${tone === "error" ? "text-red-800 dark:text-red-300" : "text-stone-500"}`}>{children}</p>;
}
