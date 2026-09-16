"use client";

import { useEffect, useState } from "react";
import { api, type AdminLegalRequest } from "@/lib/api";

const LABELS: Record<AdminLegalRequest["kind"], string> = {
  access: "Access",
  correction: "Correction",
  deletion: "Deletion",
  consent_withdrawal: "Withdraw consent",
  grievance: "Grievance",
  other: "Other",
};

/** Privacy and legal requests from the public form. The law gives a deadline, so the age of each open one is shown. */
export default function LegalRequestsPage() {
  const [requests, setRequests] = useState<AdminLegalRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.adminLegalRequests().then((r) => setRequests(r.requests), (e) => setError(e instanceof Error ? e.message : "Couldn't load requests."));
  useEffect(() => {
    void load();
  }, []);

  async function resolve(id: string) {
    await api.resolveLegalRequest(id).catch(() => undefined);
    void load();
  }

  const open = requests?.filter((r) => !r.resolvedAt).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Privacy requests</h1>
        <p className="mt-1 text-sm text-stone-400">
          {requests ? `${open} open · ${requests.length} total` : "Loading…"} · Acknowledge grievances within 24 hours; answer data requests within 30 days.
        </p>
      </div>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {requests && requests.length === 0 ? <p className="text-sm text-stone-400">No requests yet.</p> : null}
      <ul className="flex flex-col gap-3">
        {requests?.map((r) => {
          const days = Math.floor((Date.now() - Date.parse(r.createdAt)) / 86_400_000);
          return (
            <li key={r.id} className={`rounded-xl p-4 ring-1 ${r.resolvedAt ? "bg-white/[0.02] ring-white/5 opacity-60" : "bg-white/[0.04] ring-white/10"}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.kind === "deletion" || r.kind === "grievance" ? "bg-red-400/15 text-red-300" : "bg-white/10 text-stone-200"}`}>{LABELS[r.kind]}</span>
                <span className="font-medium text-white">{r.name}</span>
                <span className="text-stone-400">{r.email}</span>
                {r.signedIn ? <span className="text-xs text-emerald-400">signed in</span> : null}
                <span className={`ml-auto text-xs ${!r.resolvedAt && days >= 20 ? "text-amber-300" : "text-stone-500"}`}>
                  {new Date(r.createdAt).toLocaleString()} · {r.resolvedAt ? "resolved" : `${days}d open`}
                </span>
              </div>
              <p className="mt-2 text-sm whitespace-pre-wrap text-stone-300">{r.message}</p>
              {!r.resolvedAt ? (
                <button type="button" onClick={() => void resolve(r.id)} className="mt-3 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15">
                  Mark resolved
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
