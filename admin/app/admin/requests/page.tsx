"use client";

import type { AdminIntegrationRequestsResponse, IntegrationRequestStat } from "@plinth-pages/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";

type Filter = "all" | "planned" | "suggested";

function ago(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** Superadmin: which integrations people want, ranked, so the next codemods are the ones that matter. */
export default function IntegrationRequestsPage() {
  const router = useRouter();
  const [data, setData] = useState<AdminIntegrationRequestsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    api
      .adminIntegrationRequests()
      .then(setData)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) router.replace("/");
        else setError(e instanceof ApiError && e.status === 403 ? "Only admins can see integration requests." : e instanceof Error ? e.message : "Could not load requests");
      });
  }, [router]);

  const items = (data?.items ?? []).filter((item) => filter === "all" || (filter === "planned" ? item.planned : !item.planned));
  const top = Math.max(1, ...items.map((item) => item.count));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <Link href="/dashboard" className="w-fit text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          ← Dashboard
        </Link>
        <h1 className="text-xl font-semibold text-balance">Integration requests</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">What people asked for from the Editor&apos;s Integrations panel. One vote per person per integration.</p>
      </header>

      {error ? <p className="text-sm text-red-800 dark:text-red-300">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-zinc-500">Loading…</p> : null}

      {data ? (
        <>
          <dl className="grid grid-cols-3 divide-x divide-zinc-200 rounded-lg border border-zinc-200 bg-white text-sm tabular-nums dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {[
              ["Requests", data.totalRequests],
              ["People", data.uniqueRequesters],
              ["Integrations", data.items.length],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5 px-4 py-3">
                <dt className="text-xs text-zinc-500">{label}</dt>
                <dd className="text-lg font-semibold">{value}</dd>
              </div>
            ))}
          </dl>

          <section className="flex flex-col gap-3">
            <div role="radiogroup" aria-label="Show" className="flex w-fit rounded-md bg-zinc-100 p-0.5 text-xs dark:bg-zinc-900">
              {(["all", "planned", "suggested"] as const).map((id) => (
                <button
                  key={id}
                  role="radio"
                  aria-checked={filter === id}
                  onClick={() => setFilter(id)}
                  className={`rounded px-2.5 py-1 font-medium capitalize focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none ${
                    filter === id ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                  }`}
                >
                  {id === "all" ? "All" : id === "planned" ? "From the list" : "Suggested"}
                </button>
              ))}
            </div>

            {items.length === 0 ? <p className="text-sm text-zinc-500">No requests yet.</p> : null}
            <ol className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {items.map((item, index) => (
                <RequestRow key={item.key} item={item} rank={index + 1} share={item.count / top} />
              ))}
            </ol>
          </section>
        </>
      ) : null}
    </main>
  );
}

function RequestRow({ item, rank, share }: { item: IntegrationRequestStat; rank: number; share: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3">
        <span className="font-mono text-xs text-zinc-500 tabular-nums">#{rank}</span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {item.name}
            <span className={`rounded px-1.5 text-[10px] font-medium ${item.planned ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"}`}>
              {item.planned ? item.category : "suggested"}
            </span>
          </span>
          <span className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
            <span className="block h-full rounded-full bg-zinc-900 dark:bg-zinc-200" style={{ width: `${Math.max(4, share * 100)}%` }} />
          </span>
          <span className="font-mono text-[11px] text-zinc-500">
            {item.key} · last {ago(item.lastRequestedAt)}
          </span>
        </div>
        <span className="text-right">
          <span className="block text-lg font-semibold tabular-nums">{item.count}</span>
          {item.notes.length ? (
            <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-[11px] text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100">
              {open ? "Hide" : `${item.notes.length} note${item.notes.length === 1 ? "" : "s"}`}
            </button>
          ) : null}
        </span>
      </div>
      {open ? (
        <ul className="ml-11 flex flex-col gap-1">
          {item.notes.map((note, i) => (
            <li key={i} className="rounded-md bg-zinc-50 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
              “{note}”
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
