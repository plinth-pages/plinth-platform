"use client";

import type { PortfolioRole, PortfolioSummary } from "@plinth-pages/shared";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { PreviewPanel } from "./PreviewPanel";

const ROLES: { role: PortfolioRole; label: string; hint: string }[] = [
  { role: "developer", label: "Developer", hint: "Projects, GitHub, coding stats" },
  { role: "designer", label: "Designer", hint: "Work gallery, case studies" },
  { role: "student", label: "Student", hint: "Coursework, projects, skills" },
  { role: "creator", label: "Creator", hint: "Videos, posts, audience" },
  { role: "freelancer", label: "Freelancer", hint: "Services, clients, contact" },
  { role: "founder", label: "Founder", hint: "Company, launches, press" },
  { role: "researcher", label: "Researcher", hint: "Publications, talks" },
  { role: "other", label: "Something else", hint: "Start from the basics" },
];

const POLL_MS = 2000;

export function PortfolioPanel() {
  const [portfolios, setPortfolios] = useState<PortfolioSummary[] | null>(null);
  const [creating, setCreating] = useState<PortfolioRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { portfolios } = await api.portfolios();
    setPortfolios(portfolios);
    return portfolios;
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load portfolios"));
  }, [load]);

  const provisioning = portfolios?.some((p) => p.status === "provisioning");
  useEffect(() => {
    if (!provisioning) return;
    const timer = setInterval(() => load().catch(() => undefined), POLL_MS);
    return () => clearInterval(timer);
  }, [provisioning, load]);

  async function choose(role: PortfolioRole) {
    setCreating(role);
    setError(null);
    try {
      await api.createPortfolio(role);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await load();
      else setError(e instanceof Error ? e.message : "Could not create your portfolio");
    } finally {
      setCreating(null);
    }
  }

  async function retry(id: string) {
    setError(null);
    try {
      await api.retryPortfolio(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not retry");
    }
  }

  if (portfolios === null) {
    return error ? <ErrorNote message={error} /> : <p className="text-sm text-zinc-500">Loading your portfolio…</p>;
  }

  if (portfolios.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold tracking-tight">What describes you?</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          This sets your starting content. It never limits what you can add later.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ROLES.map(({ role, label, hint }) => (
            <button
              key={role}
              onClick={() => choose(role)}
              disabled={creating !== null}
              className="flex flex-col items-start rounded-lg border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
            >
              <span className="text-sm font-medium">{creating === role ? "Setting up…" : label}</span>
              <span className="text-xs text-zinc-500">{hint}</span>
            </button>
          ))}
        </div>
        {error ? <ErrorNote message={error} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {portfolios.map((portfolio) => (
        <div key={portfolio.id} className="flex flex-col gap-3">
          <PortfolioCard portfolio={portfolio} onRetry={() => retry(portfolio.id)} />
          {portfolio.status === "ready" ? <PreviewPanel portfolioId={portfolio.id} /> : null}
        </div>
      ))}
      {error ? <ErrorNote message={error} /> : null}
    </div>
  );
}

function PortfolioCard({ portfolio, onRetry }: { portfolio: PortfolioSummary; onRetry: () => void }) {
  const badge = {
    provisioning: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    ready: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
    failed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  }[portfolio.status];
  const label = { provisioning: "Setting up", ready: "Ready", failed: "Needs attention" }[portfolio.status];

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-sm break-all">{portfolio.repoName}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {ROLES.find((r) => r.role === portfolio.role)?.label ?? "Portfolio"} · private repository
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge}`}>{label}</span>
      </div>

      {portfolio.status === "provisioning" ? (
        <ol className="mt-4 flex flex-col gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>✓ Portfolio created</li>
          <li className="animate-pulse motion-reduce:animate-none">◐ Creating your private repository on GitHub</li>
          <li className="text-zinc-400 dark:text-zinc-600">○ Setting up draft and main branches</li>
        </ol>
      ) : null}

      {portfolio.status === "ready" && portfolio.repoUrl ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <a
            href={portfolio.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-600"
          >
            View repository ↗
          </a>
          <span className="text-zinc-500">
            Branches: <code className="font-mono">main</code> (live) · <code className="font-mono">draft</code> (edits)
          </span>
        </div>
      ) : null}

      {portfolio.status === "failed" ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm text-red-800 dark:text-red-300">{portfolio.failureReason ?? "Setup failed."}</p>
          <button
            onClick={onRetry}
            className="w-fit rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Try again
          </button>
        </div>
      ) : null}
    </article>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      {message}
    </p>
  );
}
