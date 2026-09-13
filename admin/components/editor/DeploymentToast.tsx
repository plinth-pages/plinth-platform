"use client";

import type { DeploymentSummary } from "@plinth-pages/shared";
import { useEffect, useState } from "react";

const AUTO_DISMISS_MS = 12_000;

/** Announces a deployment that finished while the editor was open: the live link, or why the build failed. */
export function DeploymentToast({ deployment, onDismiss }: { deployment: DeploymentSummary | null; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => setExpanded(false), [deployment]);
  useEffect(() => {
    if (!deployment || expanded) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [deployment, expanded, onDismiss]);

  if (!deployment) return null;
  const live = deployment.status === "ready";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-24 z-50 w-96 max-w-[calc(100vw-2rem)] rounded-lg bg-white p-4 shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${live ? "bg-emerald-500" : "bg-red-500"}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{live ? "Your site is live" : "The deployment failed"}</p>
          {live && deployment.url ? (
            <a
              href={deployment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block truncate text-xs text-emerald-800 underline decoration-emerald-300 underline-offset-4 dark:text-emerald-300"
            >
              {deployment.url.replace(/^https:\/\//, "")} ↗
            </a>
          ) : null}
          {!live ? (
            <>
              <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">Your previous version is still live.</p>
              {deployment.error ? (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="mt-2 text-xs font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-4 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none dark:text-zinc-300"
                >
                  {expanded ? "Hide details" : "Show details"}
                </button>
              ) : null}
              {expanded ? <p className="mt-2 font-mono text-[11px] whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{deployment.error}</p> : null}
            </>
          ) : null}
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mt-1 -mr-1 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none dark:hover:bg-zinc-800"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
