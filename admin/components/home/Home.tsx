"use client";

import type {
  CatalogueIntegration,
  CopilotUsage,
  InstalledIntegrationSummary,
  OperationSummary,
  PortfolioSummary,
  PublishStatusResponse,
  SessionUser,
} from "@plinth-pages/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PortfolioPanel } from "@/components/PortfolioPanel";
import { ArrowRight, Button, buttonClass } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";

const ROLE_LABELS: Record<string, string> = {
  developer: "Developer",
  designer: "Designer",
  student: "Student",
  creator: "Creator",
  freelancer: "Freelancer",
  founder: "Founder",
  researcher: "Researcher",
};

const SUGGESTIONS: Record<string, string[]> = {
  developer: ["Add my GitHub stats under my projects", "Make the hero headline bolder", "Switch to a dark theme with a teal accent"],
  student: ["Add my LeetCode stats", "Add a skills section with my top languages", "Add a contact form"],
  designer: ["Turn my projects into a large image grid", "Use a dark editorial theme", "Add a contact form"],
};
const DEFAULT_SUGGESTIONS = ["Rewrite my intro to sound more confident", "Add a contact form", "Switch to a dark theme"];

interface SiteData {
  operations: OperationSummary[];
  installed: InstalledIntegrationSummary[];
  catalogue: CatalogueIntegration[];
  usage: CopilotUsage | null;
  personalised: boolean;
}

/** The signed-in home: the site at a glance, a way straight into the co-pilot, and what to do next. */
export function Home({ user, welcome }: { user: SessionUser; welcome: boolean }) {
  const [site, setSite] = useState<PortfolioSummary | null | undefined>(undefined);

  useEffect(() => {
    api.portfolios().then(
      ({ portfolios }) => setSite(portfolios.find((p) => p.status === "ready") ?? null),
      () => setSite(null),
    );
  }, []);

  const firstName = (user.name ?? user.githubLogin).split(" ")[0];

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">
          {greeting()}, {firstName}
        </h1>
        <p className="text-[15px] text-stone-500 dark:text-stone-400">Here&apos;s where your site stands.</p>
      </div>

      {welcome && site ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-gradient-to-r from-brand-600 to-violet-600 p-5 text-white shadow-[0_20px_40px_-20px_rgb(76_98_220/0.6)] sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="text-lg font-semibold">Your site is ready</p>
            <p className="mt-0.5 text-sm text-white/80">We built it from your profile. Open the editor to make it yours — every change is checked before it lands.</p>
          </div>
          <Link href={`/portfolios/${site.id}`} className={buttonClass({ variant: "inverse", size: "md" })}>
            Open editor <ArrowRight />
          </Link>
        </div>
      ) : null}

      {site === undefined ? <Skeleton /> : site === null ? <PortfolioPanel /> : <SiteHome site={site} user={user} />}
    </main>
  );
}

function SiteHome({ site, user }: { site: PortfolioSummary; user: SessionUser }) {
  const [data, setData] = useState<SiteData | null>(null);
  // Publish status asks GitHub and the host, so it can be slow; the rest of Home doesn't wait for it.
  const [publish, setPublish] = useState<PublishStatusResponse | null | undefined>(undefined);

  const loadPublish = useCallback(() => {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000));
    void Promise.race([api.publishStatus(site.id).catch(() => null), timeout]).then(setPublish);
  }, [site.id]);

  const load = useCallback(async () => {
    const [operations, installed, catalogue, messages, setup] = await Promise.all([
      api.operations(site.id).then((r) => r.operations, () => []),
      api.installedIntegrations(site.id).then((r) => r.installed, () => []),
      api.integrations().then((r) => r.integrations, () => []),
      api.copilotMessages(site.id).catch(() => null),
      api.portfolioSetup(site.id).catch(() => null),
    ]);
    const personalise = setup?.steps.find((step) => step.id === "personalise");
    setData({
      operations,
      installed,
      catalogue,
      usage: messages?.usage ?? null,
      personalised: personalise ? personalise.state === "done" : false,
    });
  }, [site.id]);

  useEffect(() => {
    void load();
    loadPublish();
  }, [load, loadPublish]);

  if (!data) return <Skeleton />;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <SiteCard site={site} publish={publish} onPublished={loadPublish} className="lg:col-span-2" />
      <PlanCard user={user} usage={data.usage} />
      <PromptCard site={site} className="lg:col-span-2" />
      <Checklist site={site} data={data} published={Boolean(publish?.liveUrl)} />
      <IntegrationsCard site={site} installed={data.installed} catalogue={data.catalogue} className="lg:col-span-2" />
      <ActivityCard operations={data.operations} />
    </div>
  );
}

function SiteCard({ site, publish, onPublished, className = "" }: { site: PortfolioSummary; publish: PublishStatusResponse | null | undefined; onPublished: () => void; className?: string }) {
  const toast = useToast();
  const [publishing, setPublishing] = useState(false);
  const live = publish?.liveUrl ?? null;
  const pending = (publish?.unpublishedCount ?? 0) + (publish?.pendingPush ? 1 : 0);
  const busy = publishing || Boolean(publish?.publishing);
  const deployedAt = publish?.lastDeployment?.finishedAt ?? publish?.lastDeployment?.createdAt ?? "";

  const checking = publish === undefined;
  const state = checking
    ? { label: "Checking status…", tone: "bg-stone-100 text-stone-600 ring-stone-500/20 dark:bg-stone-800 dark:text-stone-300", dot: "bg-stone-400 animate-pulse" }
    : busy
    ? { label: "Publishing…", tone: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300", dot: "bg-amber-500 animate-pulse" }
    : live
      ? { label: pending ? "Live · changes to publish" : "Live", tone: "bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300", dot: "bg-emerald-500" }
      : { label: "Draft", tone: "bg-stone-100 text-stone-700 ring-stone-500/20 dark:bg-stone-800 dark:text-stone-300", dot: "bg-stone-400" };

  async function publishNow() {
    setPublishing(true);
    try {
      await api.publish(site.id);
      toast("Publishing started. Your site will update in a moment.", "success");
      onPublished();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't publish right now.", "error");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <section className={`overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200/80 dark:bg-stone-900 dark:ring-stone-800 ${className}`}>
      <div className="relative h-40 overflow-hidden bg-[#07080b]">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(70%_90%_at_80%_0%,rgb(76_98_220/0.45),transparent_60%)]" />
        <div aria-hidden className="absolute right-6 bottom-0 hidden h-28 w-80 rounded-t-xl bg-[#f7f7f5] p-4 shadow-[0_-10px_40px_-10px_rgb(0_0_0/0.6)] sm:block">
          <div className="flex items-center gap-2">
            <span className="h-6 w-6 rounded-full bg-gradient-to-br from-brand-400 to-fuchsia-400" />
            <div className="h-2.5 w-24 rounded bg-stone-800" />
          </div>
          <div className="mt-2.5 h-1.5 w-48 rounded bg-stone-300" />
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            <div className="h-7 rounded bg-white ring-1 ring-stone-200" />
            <div className="h-7 rounded bg-white ring-1 ring-stone-200" />
            <div className="h-7 rounded bg-brand-50 ring-1 ring-brand-200" />
          </div>
        </div>
        <div className="relative p-5">
          <p className="text-[11px] font-medium tracking-wider text-stone-400 uppercase">Your site</p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-white">{ROLE_LABELS[site.role] ?? "Personal"} site</p>
          <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${state.tone}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />
            {state.label}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {live ? (
            <>
              <a href={live} target="_blank" rel="noopener noreferrer" className="truncate font-medium text-stone-900 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-600 dark:text-white">
                {live.replace(/^https?:\/\//, "")}
              </a>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(live).then(() => toast("Link copied", "success"))}
                className="text-xs font-medium text-stone-500 hover:text-stone-900 dark:hover:text-white"
              >
                Copy link
              </button>
            </>
          ) : checking ? (
            <span className="h-4 w-48 animate-pulse rounded bg-stone-100 dark:bg-stone-800" />
          ) : (
            <span className="text-stone-500">Not published yet — publish to get your public link.</span>
          )}
          {deployedAt ? <span className="text-xs text-stone-400">Published {timeAgo(deployedAt)}</span> : null}
        </div>
        {pending > 0 ? (
          <p className="text-sm text-stone-600 dark:text-stone-400">
            {pending} change{pending === 1 ? "" : "s"} waiting to go live.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Link href={`/portfolios/${site.id}`} className={buttonClass({ variant: "brand", size: "md" })}>
            Open editor <ArrowRight />
          </Link>
          {!checking && (pending > 0 || !live) ? (
            <Button type="button" variant="secondary" size="md" disabled={busy} onClick={() => void publishNow()}>
              {busy ? "Publishing…" : live ? "Publish changes" : "Publish site"}
            </Button>
          ) : null}
          {live ? (
            <a href={live} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "ghost", size: "md" })}>
              View site ↗
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PlanCard({ user, usage }: { user: SessionUser; usage: CopilotUsage | null }) {
  const pro = user.plan === "pro";
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-white p-5 ring-1 ring-stone-200/80 dark:bg-stone-900 dark:ring-stone-800">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Plan & usage</p>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pro ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300" : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"}`}>
          {pro ? "Pro" : "Free"}
        </span>
      </div>
      {usage ? (
        <div className="flex flex-col gap-4">
          <Meter label="Co-pilot messages today" used={usage.used} limit={usage.limit} />
          <Meter label="AI tokens this month" used={usage.tokensUsed} limit={usage.tokenLimit} compact />
        </div>
      ) : (
        <p className="text-sm text-stone-500">Usage appears after your first co-pilot message.</p>
      )}
      <div className="mt-auto">
        {pro ? (
          <Link href="/billing" className={buttonClass({ variant: "secondary", size: "md", full: true })}>
            Manage plan
          </Link>
        ) : (
          <Link href="/billing" className={buttonClass({ variant: "brand", size: "md", full: true })}>
            Upgrade to Pro — premium models
          </Link>
        )}
      </div>
    </section>
  );
}

function Meter({ label, used, limit, compact = false }: { label: string; used: number; limit: number; compact?: boolean }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const format = (n: number) => (compact ? new Intl.NumberFormat("en", { notation: "compact" }).format(n) : String(n));
  return (
    <div>
      <p className="flex justify-between text-[13px]">
        <span className="text-stone-600 dark:text-stone-400">{label}</span>
        <span className="font-medium tabular-nums">
          {format(used)} / {format(limit)}
        </span>
      </p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
        <div className={`h-full rounded-full ${ratio > 0.85 ? "bg-amber-500" : "bg-brand-500"}`} style={{ width: `${Math.max(ratio * 100, used > 0 ? 3 : 0)}%` }} />
      </div>
    </div>
  );
}

function PromptCard({ site, className = "" }: { site: PortfolioSummary; className?: string }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const open = (text: string) => router.push(`/portfolios/${site.id}?prompt=${encodeURIComponent(text.trim())}`);

  return (
    <section className={`flex flex-col gap-4 rounded-2xl bg-white p-5 ring-1 ring-stone-200/80 dark:bg-stone-900 dark:ring-stone-800 ${className}`}>
      <div>
        <p className="text-sm font-semibold">Ask the co-pilot</p>
        <p className="mt-0.5 text-sm text-stone-500">Describe a change. We&apos;ll open the editor with it ready to send.</p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (prompt.trim()) open(prompt);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          maxLength={2000}
          placeholder="e.g. Add a projects section with my three best repos"
          className="h-11 flex-1 rounded-[10px] border-0 bg-stone-50 px-3.5 text-[15px] shadow-[0_0_0_1px_rgb(28_25_23/0.1)] placeholder:text-stone-400 focus-visible:shadow-[0_0_0_1px_rgb(76_98_220),0_0_0_4px_rgb(76_98_220/0.15)] focus-visible:outline-none dark:bg-stone-950 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.1)]"
        />
        <Button type="submit" variant="primary" size="lg" disabled={!prompt.trim()}>
          Open in editor <ArrowRight />
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {(SUGGESTIONS[site.role] ?? DEFAULT_SUGGESTIONS).map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => open(suggestion)}
            className="rounded-full bg-stone-50 px-3 py-1.5 text-[13px] text-stone-600 ring-1 ring-stone-200 transition-colors hover:bg-white hover:text-stone-900 hover:ring-stone-300 dark:bg-stone-950 dark:text-stone-400 dark:ring-stone-800 dark:hover:text-white"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </section>
  );
}

function Checklist({ site, data, published }: { site: PortfolioSummary; data: SiteData; published: boolean }) {
  // Setup's own personalisation edit is actor "system"; only the person's changes count.
  const madeChange = data.operations.some((op) => op.actor !== "system" && (op.type === "copilot" || op.type === "edit") && op.status === "applied");
  const items = [
    { label: "Site created", done: true },
    { label: "Filled in from your profile", done: data.personalised },
    { label: "Make your first co-pilot change", done: madeChange, href: `/portfolios/${site.id}` },
    { label: "Add an integration", done: data.installed.length > 0, href: `/portfolios/${site.id}` },
    { label: "Publish your site", done: published, href: `/portfolios/${site.id}` },
  ];
  const done = items.filter((item) => item.done).length;

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-white p-5 ring-1 ring-stone-200/80 dark:bg-stone-900 dark:ring-stone-800">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Launch checklist</p>
        <span className="text-xs font-medium text-stone-500 tabular-nums">
          {done}/{items.length}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <ul className="flex flex-col gap-2.5 text-sm">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2.5">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${item.done ? "bg-emerald-500 text-white" : "ring-1 ring-stone-300 dark:ring-stone-700"}`}>{item.done ? "✓" : ""}</span>
            {item.done || !item.href ? (
              <span className={item.done ? "text-stone-400 line-through decoration-stone-300" : ""}>{item.label}</span>
            ) : (
              <Link href={item.href} className="font-medium hover:text-brand-600 dark:hover:text-brand-300">
                {item.label} →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function IntegrationsCard({ site, installed, catalogue, className = "" }: { site: PortfolioSummary; installed: InstalledIntegrationSummary[]; catalogue: CatalogueIntegration[]; className?: string }) {
  const installedIds = new Set(installed.map((i) => i.id));
  const recommended = catalogue
    .filter((entry) => !installedIds.has(entry.id))
    .sort((a, b) => Number(b.recommendedFor.includes(site.role)) - Number(a.recommendedFor.includes(site.role)))
    .slice(0, 3);

  return (
    <section className={`flex flex-col gap-4 rounded-2xl bg-white p-5 ring-1 ring-stone-200/80 dark:bg-stone-900 dark:ring-stone-800 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Integrations</p>
          <p className="mt-0.5 text-sm text-stone-500">Live data and features, dropped into the right place.</p>
        </div>
        <Link href={`/portfolios/${site.id}`} className="text-sm font-medium text-stone-500 hover:text-stone-900 dark:hover:text-white">
          Browse all →
        </Link>
      </div>

      {installed.length ? (
        <div className="flex flex-wrap gap-2">
          {installed.map((item) => (
            <span key={item.id} className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-600/15 dark:bg-emerald-950 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {item.name}
            </span>
          ))}
        </div>
      ) : null}

      {recommended.length ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {recommended.map((entry) => (
            <Link
              key={entry.id}
              href={`/portfolios/${site.id}`}
              className="group flex flex-col gap-2 rounded-xl bg-stone-50 p-4 ring-1 ring-stone-200 transition-colors hover:bg-white hover:ring-stone-300 dark:bg-stone-950 dark:ring-stone-800 dark:hover:ring-stone-700"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-sm font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">{entry.name[0]}</span>
              <span className="text-sm font-semibold">{entry.name}</span>
              <span className="line-clamp-2 text-[13px] text-stone-500">{entry.description}</span>
              <span className="mt-auto text-[13px] font-medium text-brand-600 group-hover:underline dark:text-brand-300">Add to site →</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-stone-500">You&apos;ve added everything available so far — more are on the way.</p>
      )}
    </section>
  );
}

const OP_LABELS: Record<string, string> = {
  copilot: "Co-pilot",
  edit: "Edit",
  install: "Integration added",
  uninstall: "Integration removed",
  move: "Integration moved",
  theme: "Theme",
  fleet_update: "Update",
  publish: "Published",
};

function ActivityCard({ operations }: { operations: OperationSummary[] }) {
  const recent = operations.filter((op) => op.actor !== "system" || op.type === "publish").slice(0, 6);
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-white p-5 ring-1 ring-stone-200/80 dark:bg-stone-900 dark:ring-stone-800">
      <p className="text-sm font-semibold">Recent changes</p>
      {recent.length ? (
        <ol className="flex flex-col gap-3">
          {recent.map((op) => {
            const tone =
              op.status === "applied"
                ? "bg-emerald-500"
                : op.status === "rejected" || op.status === "reverted" || op.status === "failed"
                  ? "bg-red-400"
                  : "bg-amber-500 animate-pulse";
            return (
              <li key={op.id} className="flex gap-3 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone}`} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{op.summary || OP_LABELS[op.type] || "Change"}</p>
                  <p className="text-xs text-stone-500">
                    {OP_LABELS[op.type] ?? "Change"} · {statusLabel(op.status)}
                    {` · ${timeAgo(op.createdAt)}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-stone-500">Nothing yet. Your changes will show up here.</p>
      )}
    </section>
  );
}

function statusLabel(status: string): string {
  if (status === "applied") return "applied";
  if (status === "rejected") return "blocked by checks";
  if (status === "reverted") return "undone";
  if (status === "failed") return "didn't finish";
  return "in progress";
}

function Skeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-3" aria-busy="true">
      <div className="h-72 animate-pulse rounded-2xl bg-stone-200/60 motion-reduce:animate-none lg:col-span-2 dark:bg-stone-900" />
      <div className="h-72 animate-pulse rounded-2xl bg-stone-200/60 motion-reduce:animate-none dark:bg-stone-900" />
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
