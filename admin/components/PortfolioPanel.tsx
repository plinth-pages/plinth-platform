"use client";

import type { PortfolioRole, PortfolioSummary, PublishStatusResponse } from "@plinth-pages/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

const ROLES: { role: PortfolioRole; label: string; hint: string }[] = [
  { role: "developer", label: "Developer", hint: "Projects, open source, coding stats" },
  { role: "designer", label: "Designer", hint: "Work gallery, case studies" },
  { role: "student", label: "Student", hint: "Coursework, projects, skills" },
  { role: "creator", label: "Creator", hint: "Videos, posts, audience" },
  { role: "freelancer", label: "Freelancer", hint: "Services, clients, contact" },
  { role: "founder", label: "Founder", hint: "Company, launches, press" },
  { role: "researcher", label: "Researcher", hint: "Publications, talks" },
  { role: "other", label: "Something else", hint: "Start from the basics" },
];

const POLL_MS = 2000;

const roleLabel = (role: PortfolioRole) => ROLES.find((r) => r.role === role)?.label ?? "Portfolio";

export function PortfolioPanel() {
  const router = useRouter();
  const [portfolios, setPortfolios] = useState<PortfolioSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { portfolios } = await api.portfolios();
    setPortfolios(portfolios);
    return portfolios;
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load your portfolios"));
  }, [load]);

  // A new user builds their first portfolio in onboarding.
  useEffect(() => {
    if (portfolios?.length === 0) router.replace("/onboarding");
  }, [portfolios, router]);

  const provisioning = portfolios?.some((p) => p.status === "provisioning");
  useEffect(() => {
    if (!provisioning) return;
    const timer = setInterval(() => load().catch(() => undefined), POLL_MS);
    return () => clearInterval(timer);
  }, [provisioning, load]);

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
    return error ? <ErrorNote message={error} /> : <div className="h-40 animate-pulse rounded-2xl bg-stone-200/60 motion-reduce:animate-none dark:bg-stone-900" />;
  }

  if (portfolios.length === 0) return <div className="h-40 animate-pulse rounded-2xl bg-stone-200/60 motion-reduce:animate-none dark:bg-stone-900" />;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-stone-500">Your portfolios</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {portfolios.map((portfolio) => (
          <PortfolioCard key={portfolio.id} portfolio={portfolio} onRetry={() => retry(portfolio.id)} />
        ))}
      </div>
      {error ? <ErrorNote message={error} /> : null}
    </section>
  );
}

function PortfolioCard({ portfolio, onRetry }: { portfolio: PortfolioSummary; onRetry: () => void }) {
  const [publish, setPublish] = useState<PublishStatusResponse | null>(null);

  useEffect(() => {
    if (portfolio.status !== "ready") return;
    api.publishStatus(portfolio.id).then(setPublish, () => undefined);
  }, [portfolio.id, portfolio.status]);

  const live = publish?.liveUrl ?? null;
  const unpublished = (publish?.unpublishedCount ?? 0) > 0 || Boolean(publish?.pendingPush);
  const state =
    portfolio.status === "provisioning"
      ? { label: "Setting up", dot: "bg-amber-500 animate-pulse motion-reduce:animate-none" }
      : portfolio.status === "failed"
        ? { label: "Needs attention", dot: "bg-red-500" }
        : live
          ? { label: unpublished ? "Live · unpublished changes" : "Live", dot: "bg-emerald-500" }
          : { label: "Not published yet", dot: "bg-stone-400" };

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-stone-200/80 transition hover:ring-stone-300 dark:bg-stone-900 dark:ring-stone-800 dark:hover:ring-stone-700">
      <div aria-hidden className="relative h-36 border-b border-stone-100 bg-stone-100 dark:border-stone-800 dark:bg-stone-950">
        <div className="absolute inset-x-6 top-6 bottom-0 rounded-t-lg bg-white p-4 shadow-card ring-1 ring-stone-200/80 dark:bg-stone-900 dark:ring-stone-800">
          <div className="h-2 w-16 rounded bg-stone-200 dark:bg-stone-700" />
          <div className="mt-2.5 h-4 w-40 rounded bg-stone-800 dark:bg-stone-300" />
          <div className="mt-2 h-2 w-48 rounded bg-stone-200 dark:bg-stone-700" />
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="h-8 rounded bg-stone-100 dark:bg-stone-800" />
            <div className="h-8 rounded bg-stone-100 dark:bg-stone-800" />
            <div className="h-8 rounded bg-brand-50 dark:bg-brand-950" />
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold tracking-tight">{roleLabel(portfolio.role)} portfolio</h3>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-stone-500">
              <span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />
              {state.label}
            </p>
          </div>
          {live ? (
            <a href={live} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs font-medium text-stone-600 underline decoration-stone-300 underline-offset-4 hover:text-stone-900 hover:decoration-stone-600 dark:text-stone-400 dark:hover:text-stone-100">
              View site ↗
            </a>
          ) : null}
        </div>

        {portfolio.status === "provisioning" ? (
          <ol className="flex flex-col gap-1.5 text-sm text-stone-600 dark:text-stone-400">
            <li className="flex items-center gap-2">
              <span className="text-emerald-600">✓</span> Portfolio created
            </li>
            <li className="flex items-center gap-2">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-stone-300 border-t-stone-700 motion-reduce:animate-none" /> Preparing your starter site
            </li>
            <li className="flex items-center gap-2 text-stone-400">
              <span>○</span> Getting your editor ready
            </li>
          </ol>
        ) : null}

        {portfolio.status === "failed" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-red-800 dark:text-red-300">We couldn&apos;t finish setting up your portfolio.</p>
            <button onClick={onRetry} className="w-fit rounded-lg bg-white px-3 py-1.5 text-sm font-medium ring-1 ring-stone-300 hover:bg-stone-50 dark:bg-stone-900 dark:ring-stone-700 dark:hover:bg-stone-800">
              Try again
            </button>
          </div>
        ) : null}

        {portfolio.status === "ready" ? (
          <div className="mt-auto">
            <Link
              href={`/portfolios/${portfolio.id}`}
              className="inline-block rounded-lg bg-stone-900 px-3.5 py-2 text-sm font-medium text-white shadow-card hover:bg-stone-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
            >
              Open editor
            </Link>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ErrorNote({ message }: { message: string }) {
  return <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{message}</p>;
}
