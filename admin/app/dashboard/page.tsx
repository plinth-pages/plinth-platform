"use client";

import type { JobStatusResponse, SessionUser } from "@plinth/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";

type CheckState =
  | { kind: "idle" }
  | { kind: "running"; note: string }
  | { kind: "pass"; note: string }
  | { kind: "fail"; note: string };

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [queueCheck, setQueueCheck] = useState<CheckState>({ kind: "idle" });
  const [adminCheck, setAdminCheck] = useState<CheckState>({ kind: "idle" });

  useEffect(() => {
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) router.replace("/");
      });
  }, [router]);

  async function runQueueCheck() {
    setQueueCheck({ kind: "running", note: "Enqueuing…" });
    try {
      const { jobId } = await api.enqueuePing();
      let job: JobStatusResponse | undefined;
      for (let attempt = 0; attempt < 40; attempt++) {
        job = await api.jobStatus(jobId);
        if (job.state === "completed" || job.state === "failed") break;
        setQueueCheck({ kind: "running", note: `Job ${jobId}: ${job.state}` });
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const result = job?.result;
      if (job?.state === "completed" && result?.executedByRole === "worker") {
        setQueueCheck({
          kind: "pass",
          note: `Job ${jobId} ran in the worker (api pid ${result.enqueuedByPid} → worker pid ${result.executedByPid})`,
        });
      } else {
        setQueueCheck({ kind: "fail", note: `Job ${jobId} ended as ${job?.state ?? "unknown"}. Is the worker running?` });
      }
    } catch (error) {
      setQueueCheck({ kind: "fail", note: error instanceof Error ? error.message : "Request failed" });
    }
  }

  async function runAdminCheck() {
    setAdminCheck({ kind: "running", note: "Calling /admin/ping…" });
    try {
      const response = await api.adminPing();
      setAdminCheck({ kind: "pass", note: `Allowed — signed in as ${response.role}` });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      setAdminCheck(
        status === 403
          ? { kind: "pass", note: "Refused with 403 — correct for a non-admin" }
          : { kind: "fail", note: error instanceof Error ? error.message : "Request failed" },
      );
    }
  }

  async function signOut() {
    await api.logout();
    router.replace("/");
  }

  if (!user) {
    return <main className="p-10 text-sm text-zinc-500">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-10 w-10 rounded-full ring-1 ring-zinc-200 dark:ring-zinc-800" />
          ) : (
            <div className="h-10 w-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
          )}
          <div>
            <p className="font-medium">{user.name ?? user.githubLogin}</p>
            <p className="font-mono text-xs text-zinc-500">
              @{user.githubLogin} · {user.role}
            </p>
          </div>
        </div>
        <button
          onClick={signOut}
          className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-200 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Sign out
        </button>
      </header>

      <section className="mt-12">
        <h2 className="font-mono text-xs tracking-widest text-zinc-500 uppercase">Platform checks</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Phase 0 wiring. These prove the api, the worker and role guards work together; they are removed before launch.
        </p>

        <div className="mt-6 divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          <CheckRow
            title="Queue"
            description="The api enqueues a job; a separate worker process must execute it."
            action="Run"
            state={queueCheck}
            onRun={runQueueCheck}
          />
          <CheckRow
            title="Admin guard"
            description="Only admins may call /admin routes. Non-admins must get 403."
            action="Run"
            state={adminCheck}
            onRun={runAdminCheck}
          />
        </div>
      </section>
    </main>
  );
}

function CheckRow({
  title,
  description,
  action,
  state,
  onRun,
}: {
  title: string;
  description: string;
  action: string;
  state: CheckState;
  onRun: () => void;
}) {
  const tone = {
    idle: "text-zinc-500",
    running: "text-zinc-500",
    pass: "text-emerald-700 dark:text-emerald-400",
    fail: "text-red-700 dark:text-red-400",
  }[state.kind];

  return (
    <div className="flex items-start justify-between gap-6 p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
        {state.kind !== "idle" ? (
          <p className={`mt-2 font-mono text-xs break-words ${tone}`}>
            {state.kind === "pass" ? "✓ " : state.kind === "fail" ? "✕ " : "… "}
            {state.note}
          </p>
        ) : null}
      </div>
      <button
        onClick={onRun}
        disabled={state.kind === "running"}
        className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {action}
      </button>
    </div>
  );
}
