"use client";

import type { CopilotMessageSummary, CopilotModelSummary, CopilotUsage, OperationStatus, OperationSummary } from "@plinth-pages/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LockIcon, useToast } from "@/components/ui/Toast";
import { ApiError, api } from "@/lib/api";

const ACTIVE: OperationStatus[] = ["queued", "staging", "checking", "applying"];
const PREMIUM = "This model is part of Pro. Upgrade on the Plan & billing page.";

const SUGGESTIONS = ["Make it dark", "Show my best repos", "Add my work experience: ", "Rewrite my headline to sound more confident"];

const THINKING: Partial<Record<OperationStatus, string>> = {
  queued: "Getting ready…",
  staging: "Reading your site…",
  checking: "Checking the change…",
  applying: "Applying it to your preview…",
};

/** "content/profile.ts" → "Profile", "components/sections/Hero.tsx" → "Hero". */
function areaName(path: string) {
  const base = path.split("/").pop()!.replace(/\.(tsx?|css)$/, "");
  if (base === "page" || base === "layout") return "Page layout";
  if (base === "globals") return "Styles";
  return base.charAt(0).toUpperCase() + base.slice(1).replace(/[-_]/g, " ");
}

/**
 * The co-pilot: describe a change, and it's made in your preview after it passes the same checks as every other
 * change. Replies arrive through the operation's events, so the chat never blocks on the model.
 */
export function CopilotChat({ portfolioId, operations, live }: { portfolioId: string; operations: OperationSummary[]; live: boolean }) {
  const toast = useToast();
  const [messages, setMessages] = useState<CopilotMessageSummary[] | null>(null);
  const [usage, setUsage] = useState<CopilotUsage | null>(null);
  const [models, setModels] = useState<CopilotModelSummary[]>([]);
  const [model, setModel] = useState<string>("free");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.copilotMessages(portfolioId);
      setMessages(response.messages);
      setUsage(response.usage);
    } catch {
      setMessages((current) => current ?? []);
    }
  }, [portfolioId]);

  useEffect(() => {
    void load();
    api.copilotModels().then(({ models }) => {
      setModels(models);
      const preferred = models.find((m) => m.default && !m.locked) ?? models.find((m) => !m.locked);
      if (preferred) setModel(preferred.id);
    }, () => undefined);
  }, [load]);

  // Any co-pilot change moving on means a reply or a new status to show.
  const copilotSignature = useMemo(
    () => operations.filter((operation) => operation.type === "copilot" || operation.actor === "copilot").map((operation) => `${operation.id}:${operation.status}`).join(","),
    [operations],
  );
  useEffect(() => {
    void load();
  }, [copilotSignature, load]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages?.length, sending]);

  const pending = messages?.some((message) => message.role === "user" && message.operation && ACTIVE.includes(message.operation.status) && !messages.some((reply) => reply.role === "assistant" && reply.operation?.id === message.operation?.id));
  const activeStatus = operations.find((operation) => operation.type === "copilot" && ACTIVE.includes(operation.status))?.status;
  const busy = sending || Boolean(activeStatus);
  const outOfMessages = usage ? usage.used >= usage.limit || usage.tokensUsed >= usage.tokenLimit : false;
  const tokenShare = usage ? Math.min(1, usage.tokensUsed / usage.tokenLimit) : 0;

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setSending(true);
    try {
      const response = await api.sendCopilotMessage(portfolioId, { message, model });
      setDraft("");
      setMessages((current) => [...(current ?? []), response.message]);
      setUsage((current) => current && { ...current, used: current.used + 1 });
    } catch (error) {
      if (error instanceof ApiError && error.body?.code === "PREMIUM_REQUIRED") toast(PREMIUM, "premium");
      else toast(error instanceof Error ? error.message : "Your message wasn't sent", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <aside className="hidden min-h-0 flex-col border-r border-stone-200 bg-white lg:flex dark:border-stone-800 dark:bg-stone-950">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-stone-200 px-4 dark:border-stone-800">
        <SparkIcon className="h-4 w-4 text-brand-600 dark:text-brand-400" />
        <span className="text-sm font-semibold">Co-pilot</span>
        {usage ? (
          <span className="ml-auto flex items-center gap-2 text-[11px] text-stone-500 tabular-nums" title={`${usage.used} of ${usage.limit} messages today · ${Math.round(tokenShare * 100)}% of this month's allowance`}>
            {usage.plan === "pro" ? <span className="rounded bg-brand-50 px-1 font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">PRO</span> : null}
            <span className="h-1.5 w-12 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
              <span className={`block h-full rounded-full ${tokenShare > 0.9 ? "bg-red-500" : "bg-brand-500"}`} style={{ width: `${Math.max(4, tokenShare * 100)}%` }} />
            </span>
            {Math.max(0, usage.limit - usage.used)} left today
          </span>
        ) : null}
      </div>

      <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages === null ? (
          <div className="flex flex-col gap-3">
            <div className="h-10 w-3/4 animate-pulse rounded-2xl bg-stone-100 motion-reduce:animate-none dark:bg-stone-900" />
            <div className="ml-auto h-8 w-1/2 animate-pulse rounded-2xl bg-stone-100 motion-reduce:animate-none dark:bg-stone-900" />
          </div>
        ) : messages.length === 0 ? (
          <Welcome onPick={(text) => setDraft(text)} />
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
            {pending || sending ? (
              <li className="flex items-center gap-2 text-xs text-stone-500" role="status">
                <span className="flex gap-1" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 motion-reduce:animate-none" style={{ animationDelay: `${i * 120}ms` }} />
                  ))}
                </span>
                {THINKING[activeStatus ?? "queued"] ?? "Working…"}
              </li>
            ) : null}
          </ol>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
        className="shrink-0 border-t border-stone-200 p-3 dark:border-stone-800"
      >
        {outOfMessages && usage?.plan === "free" ? (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900 dark:bg-brand-950 dark:text-brand-200">
            You&apos;ve reached the Free plan&apos;s limit.
            <Link href="/billing" className="shrink-0 rounded-md bg-brand-600 px-2 py-1 font-semibold text-white hover:bg-brand-700">
              Upgrade
            </Link>
          </div>
        ) : null}
        <div className="rounded-xl bg-stone-50 ring-1 ring-stone-200 focus-within:ring-2 focus-within:ring-brand-500 dark:bg-stone-900 dark:ring-stone-800">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send(draft);
              }
            }}
            rows={3}
            maxLength={2000}
            disabled={!live || outOfMessages}
            placeholder={!live ? "Your preview is starting…" : outOfMessages ? "You've reached your co-pilot limit" : "Describe a change…"}
            aria-label="Message the co-pilot"
            className="block w-full resize-none bg-transparent px-3 pt-2.5 text-sm placeholder:text-stone-400 focus:outline-none disabled:cursor-not-allowed"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <ModelSelect models={models} value={model} onChange={setModel} onLocked={() => toast(PREMIUM, "premium")} />
            <button
              type="submit"
              disabled={!draft.trim() || busy || !live || outOfMessages}
              aria-label="Send"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-stone-900 text-white hover:bg-stone-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-stone-300 dark:bg-white dark:text-stone-900 dark:disabled:bg-stone-700"
            >
              <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4" fill="currentColor">
                <path d="M8 2.5a.75.75 0 0 1 .53.22l4.25 4.25a.75.75 0 0 1-1.06 1.06L8.75 5.06v7.69a.75.75 0 0 1-1.5 0V5.06L4.28 8.03a.75.75 0 0 1-1.06-1.06l4.25-4.25A.75.75 0 0 1 8 2.5Z" />
              </svg>
            </button>
          </div>
        </div>
        <p className="mt-2 px-1 text-[11px] text-stone-400">Every change is checked before it reaches your preview, and undone if it breaks anything.</p>
      </form>
    </aside>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col justify-end gap-4">
      <div>
        <p className="text-sm font-semibold">What should we change?</p>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">Describe it in your own words — layout, colours, wording, or live stats from the places you work.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onPick(suggestion)}
            className="rounded-lg bg-stone-50 px-3 py-2 text-left text-[13px] text-stone-700 ring-1 ring-stone-200 hover:bg-white hover:ring-stone-300 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:bg-stone-900 dark:text-stone-300 dark:ring-stone-800"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function Message({ message }: { message: CopilotMessageSummary }) {
  if (message.role === "user") {
    return (
      <li className="ml-8 self-end rounded-2xl rounded-br-md bg-stone-900 px-3.5 py-2 text-sm whitespace-pre-wrap text-white dark:bg-stone-100 dark:text-stone-900">
        {message.content}
      </li>
    );
  }

  const status = message.operation?.status;
  const undone = status === "rejected" || status === "reverted" || (status === "failed" && !message.refused);
  const applied = status === "applied" && !message.refused && Boolean(message.changes?.files.length);
  const areas = [...new Set(message.changes?.files.map(areaName) ?? [])];

  return (
    <li className="mr-6 flex flex-col gap-2">
      <div className="rounded-2xl rounded-bl-md bg-stone-100 px-3.5 py-2.5 text-sm whitespace-pre-wrap text-stone-800 dark:bg-stone-900 dark:text-stone-200">{message.content}</div>
      {undone && message.changes?.files.length ? (
        <p className="flex items-center gap-1.5 px-1 text-xs text-amber-800 dark:text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> This couldn&apos;t be applied safely, so nothing changed.
        </p>
      ) : null}
      {applied ? (
        <p className="flex flex-wrap items-center gap-1.5 px-1 text-xs text-stone-500">
          <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
            </svg>
            Applied
          </span>
          {areas.map((area) => (
            <span key={area} className="rounded-full bg-white px-2 py-0.5 ring-1 ring-stone-200 dark:bg-stone-950 dark:ring-stone-800">
              {area}
            </span>
          ))}
        </p>
      ) : null}
      {message.changes?.integrations.length ? (
        <p className="px-1 text-xs text-stone-500">Also queued: {message.changes.integrations.join(", ")}</p>
      ) : null}
    </li>
  );
}

function ModelSelect({ models, value, onChange, onLocked }: { models: CopilotModelSummary[]; value: string; onChange: (id: string) => void; onLocked: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = models.find((model) => model.id === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-200/70 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:text-stone-300 dark:hover:bg-stone-800"
      >
        {current ? `${current.label} (${current.badge})` : "Model"}
        <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3" fill="currentColor">
          <path d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </button>
      {open ? (
        <ul role="listbox" aria-label="Model" className="animate-toast-in absolute bottom-full left-0 z-30 mb-2 w-64 rounded-xl bg-white p-1.5 shadow-float ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800">
          {models.map((model) => (
            <li key={model.id}>
              <button
                type="button"
                role="option"
                aria-selected={model.id === value}
                aria-disabled={model.locked}
                onClick={() => {
                  if (model.locked) {
                    onLocked();
                    return;
                  }
                  onChange(model.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${model.locked ? "cursor-not-allowed text-stone-400 dark:text-stone-500" : "hover:bg-stone-100 dark:hover:bg-stone-800"}`}
              >
                <span className="flex-1">
                  {model.label} <span className="text-stone-400">({model.badge})</span>
                </span>
                {model.locked ? (
                  <span className="flex items-center gap-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                    <LockIcon className="h-3 w-3" /> Pro
                  </span>
                ) : model.id === value ? (
                  <svg viewBox="0 0 16 16" className="h-4 w-4 text-brand-600" fill="currentColor" aria-hidden>
                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                  </svg>
                ) : null}
              </button>
            </li>
          ))}
          {models.some((model) => model.locked) ? (
            <li className="mt-1 border-t border-stone-100 px-2.5 pt-2 pb-1 dark:border-stone-800">
              <Link href="/billing" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
                Upgrade to Pro for Claude and GPT-4o →
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 1.5a.5.5 0 0 1 .47.33l1.2 3.3a1.5 1.5 0 0 0 .9.9l3.3 1.2a.5.5 0 0 1 0 .94l-3.3 1.2a1.5 1.5 0 0 0-.9.9l-1.2 3.3a.5.5 0 0 1-.94 0l-1.2-3.3a1.5 1.5 0 0 0-.9-.9l-3.3-1.2a.5.5 0 0 1 0-.94l3.3-1.2a1.5 1.5 0 0 0 .9-.9l1.2-3.3A.5.5 0 0 1 8 1.5Z" />
    </svg>
  );
}
