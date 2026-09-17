"use client";

import type { OperationFailure } from "@plinth-pages/shared";
import { useEffect, useState } from "react";
import type { Outcome } from "@/lib/useOperations";

const AUTO_DISMISS_MS = 10_000;

const SOURCE_LABEL: Record<OperationFailure["source"], string> = {
  tsc: "Code check",
  plinth: "Page structure",
  format: "Formatting",
  install: "Installing packages",
  render: "Page render",
  build: "Production build",
  codemod: "Placing the integration",
  copilot: "Plinth AI",
};

/** A gentle notice that a change was not applied. Details are one click away and never shown by default. */
export function OutcomeToast({ outcome, onDismiss }: { outcome: Outcome | null; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => setExpanded(false), [outcome]);

  // Dismisses itself, unless someone is reading the details.
  useEffect(() => {
    if (!outcome || expanded) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [outcome, expanded, onDismiss]);

  if (!outcome) return null;
  const { operation } = outcome;
  const isPublish = operation.type === "publish";
  const published = isPublish && operation.status === "applied";
  const title = published ? "Published" : isPublish ? "Couldn't publish" : "This change couldn't be applied safely";
  const detail = published
    ? `${operation.diff ?? "Your latest changes are live."}`
    : isPublish && operation.status === "rejected"
      ? "The production build failed, so the live version didn't change."
      : isPublish
        ? "The live version didn't change."
        :
    operation.status === "reverted"
      ? "It broke the page, so Plinth undid it. Your site is as it was."
      : operation.status === "failed"
        ? operation.commitSha
          ? "Plinth couldn't confirm the result. Check the preview."
          : "Nothing was changed."
        : "Your site was left exactly as it was.";

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto fixed right-4 bottom-4 z-50 w-96 max-w-[calc(100vw-2rem)] rounded-lg bg-white p-4 shadow-xl ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${published ? "bg-emerald-500" : "bg-amber-500"}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-xs text-stone-600 dark:text-stone-400">
            {detail} {isPublish ? null : <span className="text-stone-500">“{operation.summary}”</span>}
          </p>
          {expanded ? (
            <ul className="mt-3 flex max-h-56 flex-col gap-2 overflow-auto">
              {operation.error ? <li className="text-xs text-stone-700 dark:text-stone-300">{operation.error}</li> : null}
              {operation.failures.map((failure, index) => (
                <li key={index} className="rounded-md bg-stone-50 p-2 text-xs dark:bg-stone-950">
                  <span className="font-medium">{SOURCE_LABEL[failure.source]}</span>
                  {failure.file ? (
                    <span className="ml-1.5 font-mono text-[11px] text-stone-500">
                      {failure.file}
                      {failure.line ? `:${failure.line}` : ""}
                    </span>
                  ) : null}
                  <span className="mt-0.5 block font-mono text-[11px] whitespace-pre-wrap text-stone-700 dark:text-stone-300">{failure.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex gap-3">
            {operation.failures.length || operation.error ? (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs font-medium text-stone-700 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-600 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none dark:text-stone-300"
              >
                {expanded ? "Hide details" : "Show details"}
              </button>
            ) : null}
          </div>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mt-1 -mr-1 rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none dark:hover:bg-stone-800"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
