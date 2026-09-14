"use client";

import type { AdminMetricsResponse, OperationStatus } from "@plinth-pages/shared";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const OPERATION_TONE: Record<OperationStatus, string> = {
  queued: "bg-stone-400",
  staging: "bg-amber-400",
  checking: "bg-amber-500",
  applying: "bg-amber-600",
  applied: "bg-emerald-500",
  rejected: "bg-stone-500",
  reverted: "bg-violet-500",
  failed: "bg-red-500",
};

/** Haiku on-demand pricing (USD per million tokens), for a rough spend figure. */
const HAIKU_PRICE = { input: 0.25, output: 1.25 };

export default function AdminOverviewPage() {
  const [metrics, setMetrics] = useState<AdminMetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adminMetrics().then(setMetrics, (e) => setError(e instanceof Error ? e.message : "Could not load metrics"));
  }, []);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!metrics) return <p className="text-sm text-stone-500">Loading…</p>;

  const operations = Object.entries(metrics.operations7d) as [OperationStatus, number][];
  const totalOperations = operations.reduce((sum, [, count]) => sum + count, 0);
  const spend = (metrics.copilot7d.inputTokens * HAIKU_PRICE.input + metrics.copilot7d.outputTokens * HAIKU_PRICE.output) / 1_000_000;

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-stone-500">Platform activity. Changes and co-pilot figures cover the last 7 days.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="MRR" value={metrics.plans.mrrUsd} prefix="$" note={`${metrics.plans.pro} Pro × $15`} />
        <Stat label="Pro users" value={metrics.plans.pro} note={`${metrics.users ? Math.round((metrics.plans.pro / metrics.users) * 100) : 0}% of users · ${metrics.plans.upgrades30d} upgrades in 30 days`} />
        <Stat label="New sign-ups" value={metrics.plans.signups7d} note="Last 7 days" />
        <Stat label="AI tokens (30 days)" value={metrics.copilot30d.tokens} note={`${metrics.copilot30d.messages.toLocaleString()} co-pilot replies`} />
      </div>

      {metrics.copilot30d.byModel.length ? (
        <section className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-stone-200/80 dark:bg-stone-900 dark:ring-stone-800">
          <h2 className="font-medium">AI usage by model · 30 days</h2>
          <ul className="mt-4 flex flex-col gap-2.5">
            {metrics.copilot30d.byModel.map((row) => (
              <li key={row.model} className="grid grid-cols-[9rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                <span className="truncate font-mono text-xs">{row.model}</span>
                <span className="h-2 rounded-full bg-stone-100 dark:bg-stone-800">
                  <span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.max(2, (row.tokens / Math.max(1, metrics.copilot30d.byModel[0].tokens)) * 100)}%` }} />
                </span>
                <span className="text-xs text-stone-500 tabular-nums">
                  {compact(row.tokens)} tokens · {row.messages}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Users" value={metrics.users} note={`${metrics.plans.free} Free · ${metrics.plans.pro} Pro`} />
        <Stat label="Portfolios" value={metrics.portfolios.total} note={`${metrics.portfolios.ready} ready · ${metrics.portfolios.provisioning} setting up · ${metrics.portfolios.failed} failed`} />
        <Stat label="Previews running" value={metrics.sandboxesRunning} note="Billed by the minute" />
        <Stat label="Integrations installed" value={metrics.integrations.installed} note={`${metrics.integrations.requests} requests`} />
      </div>

      <section className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-stone-200/80 dark:bg-stone-900 dark:ring-stone-800">
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">Changes</h2>
          <span className="text-sm text-stone-500 tabular-nums">{totalOperations} total</span>
        </div>
        <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
          {operations
            .filter(([, count]) => count > 0)
            .map(([status, count]) => (
              <span key={status} className={OPERATION_TONE[status]} style={{ width: `${(count / Math.max(1, totalOperations)) * 100}%` }} title={`${status}: ${count}`} />
            ))}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          {operations.map(([status, count]) => (
            <div key={status} className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-2 text-stone-600 capitalize dark:text-stone-400">
                <span className={`h-2 w-2 rounded-full ${OPERATION_TONE[status]}`} />
                {status}
              </dt>
              <dd className="font-medium tabular-nums">{count}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-stone-200/80 dark:bg-stone-900 dark:ring-stone-800">
          <h2 className="font-medium">Co-pilot</h2>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <Figure label="Messages" value={metrics.copilot7d.messages.toLocaleString()} />
            <Figure label="Tokens in / out" value={`${compact(metrics.copilot7d.inputTokens)} / ${compact(metrics.copilot7d.outputTokens)}`} />
            <Figure label="Est. spend" value={`$${spend.toFixed(2)}`} />
          </dl>
        </section>
        <section className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-stone-200/80 dark:bg-stone-900 dark:ring-stone-800">
          <h2 className="font-medium">Publishing</h2>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <Figure label="Deployed" value={String(metrics.deployments7d.ready)} />
            <Figure label="Failed" value={String(metrics.deployments7d.failed)} />
            <Figure
              label="Success rate"
              value={metrics.deployments7d.ready + metrics.deployments7d.failed ? `${Math.round((metrics.deployments7d.ready / (metrics.deployments7d.ready + metrics.deployments7d.failed)) * 100)}%` : "—"}
            />
          </dl>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, note, prefix = "" }: { label: string; value: number; note?: string; prefix?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-stone-200/80 dark:bg-stone-900 dark:ring-stone-800">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
        {prefix}
        {value.toLocaleString()}
      </p>
      {note ? <p className="mt-1 truncate text-xs text-stone-500">{note}</p> : null}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function compact(n: number) {
  return Intl.NumberFormat("en", { notation: "compact" }).format(n);
}
