"use client";

import type { JobStatusResponse } from "@plinth-pages/shared";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";

type CheckState =
  | { kind: "idle" }
  | { kind: "running"; note: string }
  | { kind: "pass"; note: string }
  | { kind: "fail"; note: string };

/** Development wiring checks from Phase 0. Removed before launch. */
export function PlatformChecks() {
  const [queueCheck, setQueueCheck] = useState<CheckState>({ kind: "idle" });
  const [adminCheck, setAdminCheck] = useState<CheckState>({ kind: "idle" });

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
      setQueueCheck(
        job?.state === "completed" && result?.executedByRole === "worker"
          ? {
              kind: "pass",
              note: `Job ${jobId} ran in the worker (api pid ${result.enqueuedByPid} → worker pid ${result.executedByPid})`,
            }
          : { kind: "fail", note: `Job ${jobId} ended as ${job?.state ?? "unknown"}. Is the worker running?` },
      );
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

  return (
    <section>
      <h2 className="font-mono text-xs tracking-widest text-zinc-500 uppercase">Platform checks</h2>
      <div className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        <CheckRow
          title="Queue"
          description="The api enqueues a job; a separate worker process must execute it."
          state={queueCheck}
          onRun={runQueueCheck}
        />
        <CheckRow
          title="Admin guard"
          description="Only admins may call /admin routes. Non-admins must get 403."
          state={adminCheck}
          onRun={runAdminCheck}
        />
      </div>
    </section>
  );
}

function CheckRow({
  title,
  description,
  state,
  onRun,
}: {
  title: string;
  description: string;
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
        Run
      </button>
    </div>
  );
}
