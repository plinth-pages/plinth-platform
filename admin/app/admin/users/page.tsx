"use client";

import type { AdminUserSummary, AdminUsersResponse } from "@plinth-pages/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

const FILTERS = [
  { key: "plan", label: "Plan", options: [["", "Any plan"], ["pro", "Pro"], ["free", "Free"]] },
  { key: "role", label: "Role", options: [["", "Any role"], ["admin", "Admins"], ["user", "Users"]] },
  { key: "status", label: "Status", options: [["", "Any status"], ["active", "Active"], ["suspended", "Suspended"]] },
] as const;

const control =
  "h-9 rounded-lg border-0 bg-white/[0.04] px-3 text-sm text-white ring-1 ring-white/10 [color-scheme:dark] placeholder:text-stone-500 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none [&>option]:bg-stone-900 [&>option]:text-white";
const action = "rounded-md px-2 py-1 text-xs font-medium text-stone-300 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-50";

/** Everyone using Plinth, with the switches support needs: Pro, admin, and access. */
export default function AdminUsersPage() {
  const [filters, setFilters] = useState({ q: "", plan: "", role: "", status: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.adminUsers({ ...filters, page }).then(setData, (e) => setError(e instanceof Error ? e.message : "Couldn't load users."));
  }, [filters, page]);

  useEffect(() => {
    const timer = setTimeout(load, filters.q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, filters.q]);

  async function act(id: string, change: () => Promise<{ user: AdminUserSummary }>) {
    setBusyId(id);
    setError(null);
    try {
      const { user } = await change();
      setData((current) => current && { ...current, users: current.users.map((row) => (row.id === user.id ? user : row)) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusyId(null);
    }
  }

  function suspend(user: AdminUserSummary) {
    if (user.suspendedAt) return act(user.id, () => api.setUserSuspended(user.id, false));
    const reason = window.prompt(`Block ${user.email ?? user.githubLogin}? They'll be signed out and told why. Reason (optional):`);
    if (reason === null) return;
    return act(user.id, () => api.setUserSuspended(user.id, true, reason.trim() || undefined));
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const set = (key: keyof typeof filters) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: event.target.value }));
  };

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Users</h1>
          <p className="mt-1 text-sm text-stone-400">
            {data ? `${data.totals.all} signed up · ${data.totals.pro} on Pro · ${data.totals.suspended} suspended` : "Loading…"}
          </p>
        </div>
        <a href={api.adminUsersCsvUrl} className="rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/15">
          Export CSV
        </a>
      </header>

      <div className="flex flex-wrap gap-2">
        <input value={filters.q} onChange={set("q")} placeholder="Search name, email or handle" aria-label="Search users" className={`${control} min-w-56 flex-1`} />
        {FILTERS.map((filter) => (
          <select key={filter.key} value={filters[filter.key]} onChange={set(filter.key)} aria-label={filter.label} className={control}>
            {filter.options.map(([value, label]) => (
              <option key={label} value={value}>
                {label}
              </option>
            ))}
          </select>
        ))}
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      <section className="overflow-x-auto rounded-2xl ring-1 ring-white/10">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-white/[0.03] text-xs text-stone-400">
            <tr>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Sites</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {data === null ? (
              <Row>Loading…</Row>
            ) : data.users.length === 0 ? (
              <Row>No one matches those filters.</Row>
            ) : (
              data.users.map((user) => (
                <tr key={user.id} className={`border-t border-white/5 align-top ${user.suspendedAt ? "opacity-60" : ""}`}>
                  <td className="px-4 py-3">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-white">
                      {user.name ?? user.githubLogin}
                      {user.role === "admin" ? <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-[11px] text-brand-200">admin</span> : null}
                      {user.suspendedAt ? <span className="rounded-full bg-red-400/15 px-2 py-0.5 text-[11px] text-red-300">suspended</span> : null}
                      {user.termsAcceptedAt ? null : <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-stone-400">terms pending</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-400">
                      {user.email ?? "—"} · {user.signedUpWith === "github" ? `GitHub @${user.githubLogin}` : "email"}
                    </p>
                    {user.suspendedReason ? <p className="mt-0.5 text-xs text-red-300">{user.suspendedReason}</p> : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className={user.plan === "pro" ? "font-medium text-brand-200" : "text-stone-300"}>{user.plan === "pro" ? "Pro" : "Free"}</span>
                    {user.subscriptionStatus ? <p className="text-xs text-stone-500">{user.subscriptionStatus}{user.cancelsAtPeriodEnd ? " · ending" : ""}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-stone-300 tabular-nums">{user.portfolios}</td>
                  <td className="px-4 py-3 text-xs text-stone-400">{new Date(user.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button type="button" disabled={busyId === user.id} onClick={() => void act(user.id, () => api.setUserPlan(user.id, user.plan === "pro" ? "free" : "pro"))} className={action}>
                      {user.plan === "pro" ? "Remove Pro" : "Give Pro"}
                    </button>
                    <button type="button" disabled={busyId === user.id} onClick={() => void act(user.id, () => api.setUserRole(user.id, user.role === "admin" ? "user" : "admin"))} className={`${action} ml-2`}>
                      {user.role === "admin" ? "Remove admin" : "Make admin"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === user.id}
                      onClick={() => void suspend(user)}
                      className={`ml-2 rounded-md px-2 py-1 text-xs font-medium ring-1 disabled:opacity-50 ${
                        user.suspendedAt ? "text-emerald-300 ring-emerald-400/20 hover:bg-emerald-400/10" : "text-red-300 ring-red-400/20 hover:bg-red-400/10"
                      }`}
                    >
                      {user.suspendedAt ? "Restore access" : "Block access"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {data && data.total > data.pageSize ? (
        <div className="flex items-center justify-between text-sm text-stone-400">
          <span>
            {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </span>
          <span className="flex gap-2">
            <button type="button" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)} className={action}>
              Previous
            </button>
            <span className="px-1 py-1 text-xs">
              Page {data.page} of {pages}
            </span>
            <button type="button" disabled={data.page >= pages} onClick={() => setPage((p) => p + 1)} className={action}>
              Next
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={5} className="px-4 py-6 text-stone-500">
        {children}
      </td>
    </tr>
  );
}
