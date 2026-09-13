"use client";

import type { PublishStatusResponse } from "@plinth-pages/shared";

const STEP: Record<string, string> = {
  queued: "Waiting…",
  staging: "Preparing…",
  checking: "Building…",
  applying: "Publishing…",
};

/**
 * Promotes the draft to the live branch. Shows how many changes would go live; while publishing, shows the step.
 * The work happens in the background — the request only queues it.
 */
export function PublishButton({
  status,
  publishing,
  deploying,
  onPublish,
  error,
}: {
  status: PublishStatusResponse | null;
  publishing: boolean;
  deploying: boolean;
  onPublish: () => void;
  error: string | null;
}) {
  const failed = status?.lastDeployment?.status === "failed";
  const count = status?.unpublishedCount ?? 0;
  const hasChanges = count > 0 || Boolean(status?.pendingPush);
  const label = publishing ? (STEP[status?.publishing?.status ?? "queued"] ?? "Publishing…") : hasChanges ? "Publish" : "Published";
  const title = publishing
    ? "Building your draft and publishing it. You can keep editing."
    : hasChanges
      ? `${count || "Unpushed"} change${count === 1 ? "" : "s"} on your draft not published yet`
      : status
        ? "Everything on your draft is published"
        : "Checking what's unpublished…";

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="max-w-48 truncate text-xs text-red-700 dark:text-red-300">{error}</span> : null}
      {deploying ? (
        <span role="status" className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400" title="Vercel is building the published version">
          <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500 motion-reduce:animate-none" />
          Deploying…
        </span>
      ) : failed ? (
        <span className="text-xs text-red-700 dark:text-red-300" title={status?.lastDeployment?.error ?? undefined}>
          Deploy failed
        </span>
      ) : null}
      {status?.liveUrl ? (
        <a
          href={status.liveUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={status.liveUrl}
          className="rounded-md px-2 py-1 text-xs font-medium text-emerald-800 underline decoration-emerald-300 underline-offset-4 hover:decoration-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none dark:text-emerald-300"
        >
          Live ↗
        </a>
      ) : null}
      <button
        onClick={onPublish}
        disabled={!status || publishing || !hasChanges}
        title={title}
        aria-live="polite"
        className="flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-default disabled:bg-zinc-200 disabled:text-zinc-600 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-400"
      >
        {publishing ? (
          <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" />
        ) : null}
        {label}
        {!publishing && count > 0 ? (
          <span className="rounded-full bg-white/20 px-1.5 text-[11px] tabular-nums" aria-label={`${count} unpublished`}>
            {count}
          </span>
        ) : null}
      </button>
    </div>
  );
}
