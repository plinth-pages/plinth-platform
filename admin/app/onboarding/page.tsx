"use client";

import type { OnboardingTheme, PortfolioRole, SessionUser, SetupStatusResponse } from "@plinth-pages/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/Brand";
import { ApiError, api } from "@/lib/api";

type Stage = "role" | "look" | "setup";

const ROLES: { role: PortfolioRole; label: string; hint: string; icon: string }[] = [
  { role: "developer", label: "Developer", hint: "Projects, open source, coding stats", icon: "M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" },
  { role: "designer", label: "Designer", hint: "Work gallery, case studies", icon: "M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.9 1.5-1.6 0-1.4-1-1.9-1-3 0-.9.7-1.4 1.6-1.4H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7ZM7.5 11.5h.01M10 7.5h.01M15 7.5h.01" },
  { role: "student", label: "Student", hint: "Coursework, projects, skills", icon: "M3 9l9-5 9 5-9 5-9-5Zm4 2.5V16c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.5" },
  { role: "creator", label: "Creator", hint: "Videos, posts, audience", icon: "M15 10l5-3v10l-5-3M4 7h11v10H4z" },
  { role: "freelancer", label: "Freelancer", hint: "Services, clients, contact", icon: "M4 8h16v11H4zM9 8V5h6v3M4 13h16" },
  { role: "founder", label: "Founder", hint: "Company, launches, press", icon: "M5 19c1-4 3-7 7-11 2-2 5-3 7-3 0 2-1 5-3 7-4 4-7 6-11 7Zm4-4-3-3M14 10h.01" },
  { role: "researcher", label: "Researcher", hint: "Publications, talks", icon: "M10 3v6L4 19h16l-6-10V3M8 3h8M7 15h10" },
  { role: "other", label: "Something else", hint: "Start from the basics", icon: "M12 5v14M5 12h14" },
];

const ACCENTS = [
  { name: "Indigo", value: "#4c62dc" },
  { name: "Blue", value: "#2563eb" },
  { name: "Teal", value: "#0d9488" },
  { name: "Emerald", value: "#059669" },
  { name: "Amber", value: "#d97706" },
  { name: "Rose", value: "#e11d48" },
  { name: "Violet", value: "#7c3aed" },
  { name: "Graphite", value: "#334155" },
];

export default function OnboardingPage() {
  return (
    <Suspense fallback={<main className="min-h-screen" aria-busy="true" />}>
      <Onboarding />
    </Suspense>
  );
}

function Onboarding() {
  const router = useRouter();
  const params = useSearchParams();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [stage, setStage] = useState<Stage>(params.get("portfolio") ? "setup" : "role");
  const [role, setRole] = useState<PortfolioRole | null>(null);
  const [theme, setTheme] = useState<OnboardingTheme>({ mode: "light", accent: ACCENTS[0].value });
  const [portfolioId, setPortfolioId] = useState<string | null>(params.get("portfolio"));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(({ user }) => setUser(user), (e) => e instanceof ApiError && e.status === 401 && router.replace("/"));
    const existing = params.get("portfolio");
    if (existing) {
      api.portfolio(existing).then(({ portfolio }) => portfolio.theme && setTheme(portfolio.theme), () => undefined);
      return;
    }
    // Someone who already has a portfolio never starts over.
    api.portfolios().then(({ portfolios }) => {
      if (portfolios[0]) router.replace(portfolios[0].status === "ready" ? `/portfolios/${portfolios[0].id}` : `/onboarding?portfolio=${portfolios[0].id}`);
    }, () => undefined);
  }, [params, router]);

  async function create() {
    if (!role) return;
    setCreating(true);
    setError(null);
    try {
      const { portfolio } = await api.createPortfolio(role, theme);
      setPortfolioId(portfolio.id);
      window.history.replaceState(null, "", `/onboarding?portfolio=${portfolio.id}`);
      setStage("setup");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && typeof e.body?.portfolioId === "string") {
        setPortfolioId(e.body.portfolioId);
        setStage("setup");
      } else {
        setError(e instanceof Error ? e.message : "We couldn't start creating your portfolio.");
      }
    } finally {
      setCreating(false);
    }
  }

  const name = user?.name ?? user?.githubLogin ?? "Your name";
  const stageIndex = { role: 0, look: 1, setup: 2 }[stage];

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <BrandMark className="h-5 w-5" />
          <span className="text-[15px] font-semibold tracking-tight">Plinth</span>
        </div>
        <ol aria-label="Progress" className="flex items-center gap-2 text-xs">
          {["Your role", "Your look", "Setup"].map((label, index) => (
            <li key={label} className="flex items-center gap-2">
              <span
                aria-current={index === stageIndex ? "step" : undefined}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
                  index === stageIndex ? "bg-stone-900 text-white dark:bg-white dark:text-stone-900" : index < stageIndex ? "text-stone-700 dark:text-stone-300" : "text-stone-400"
                }`}
              >
                {index < stageIndex ? "✓" : index + 1} <span className="hidden sm:inline">{label}</span>
              </span>
              {index < 2 ? <span aria-hidden className="h-px w-5 bg-stone-300 dark:bg-stone-700" /> : null}
            </li>
          ))}
        </ol>
      </header>

      <main className="mx-auto max-w-6xl px-6 pt-6 pb-16">
        {stage === "role" ? (
          <section className="mx-auto max-w-4xl">
            <h1 className="text-3xl font-semibold tracking-tight text-balance">
              Welcome{user ? `, ${name.split(" ")[0]}` : ""}. What describes you best?
            </h1>
            <p className="mt-2 text-stone-600 dark:text-stone-400">This picks your starting content. You can change anything later.</p>
            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ROLES.map((option) => {
                const selected = role === option.role;
                return (
                  <button
                    key={option.role}
                    onClick={() => setRole(option.role)}
                    aria-pressed={selected}
                    className={`group flex flex-col items-start gap-3 rounded-2xl bg-white p-4 text-left shadow-card ring-1 transition focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:bg-stone-900 ${
                      selected ? "ring-2 ring-stone-900 dark:ring-white" : "ring-stone-200/80 hover:ring-stone-300 dark:ring-stone-800 dark:hover:ring-stone-600"
                    }`}
                  >
                    <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${selected ? "bg-stone-900 text-white dark:bg-white dark:text-stone-900" : "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300"}`}>
                      <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d={option.icon} />
                      </svg>
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className="mt-0.5 block text-xs text-stone-500">{option.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-8 flex justify-end">
              <button
                onClick={() => setStage("look")}
                disabled={!role}
                className="rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-stone-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-stone-300 dark:bg-white dark:text-stone-900 dark:disabled:bg-stone-700"
              >
                Continue
              </button>
            </div>
          </section>
        ) : null}

        {stage === "look" ? (
          <section className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Pick a look</h1>
              <p className="mt-2 text-stone-600 dark:text-stone-400">A starting point. Ask the co-pilot to change it any time.</p>

              <fieldset className="mt-8">
                <legend className="text-sm font-medium">Appearance</legend>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {(["light", "dark"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setTheme((current) => ({ ...current, mode }))}
                      aria-pressed={theme.mode === mode}
                      className={`flex items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-card ring-1 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:bg-stone-900 ${
                        theme.mode === mode ? "ring-2 ring-stone-900 dark:ring-white" : "ring-stone-200/80 hover:ring-stone-300 dark:ring-stone-800"
                      }`}
                    >
                      <span aria-hidden className={`h-10 w-14 rounded-lg ring-1 ring-stone-200 dark:ring-stone-700 ${mode === "light" ? "bg-white" : "bg-stone-900"}`}>
                        <span className={`mt-2 ml-2 block h-1.5 w-7 rounded ${mode === "light" ? "bg-stone-800" : "bg-stone-100"}`} />
                        <span className={`mt-1 ml-2 block h-1.5 w-5 rounded ${mode === "light" ? "bg-stone-300" : "bg-stone-600"}`} />
                      </span>
                      <span className="text-sm font-medium capitalize">{mode}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="mt-8">
                <legend className="text-sm font-medium">Accent colour</legend>
                <div className="mt-3 flex flex-wrap gap-2.5">
                  {ACCENTS.map((accent) => (
                    <button
                      key={accent.value}
                      onClick={() => setTheme((current) => ({ ...current, accent: accent.value }))}
                      aria-pressed={theme.accent === accent.value}
                      aria-label={accent.name}
                      title={accent.name}
                      className={`h-9 w-9 rounded-full ring-offset-2 ring-offset-stone-50 focus-visible:outline-none dark:ring-offset-stone-950 ${theme.accent === accent.value ? "ring-2 ring-stone-900 dark:ring-white" : "hover:scale-105"}`}
                      style={{ backgroundColor: accent.value }}
                    />
                  ))}
                </div>
              </fieldset>

              {error ? <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</p> : null}

              <div className="mt-10 flex items-center justify-between">
                <button onClick={() => setStage("role")} className="rounded-xl px-3 py-2 text-sm text-stone-600 hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800">
                  ← Back
                </button>
                <button
                  onClick={() => void create()}
                  disabled={creating}
                  className="rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-stone-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60 dark:bg-white dark:text-stone-900"
                >
                  {creating ? "Starting…" : "Create my portfolio"}
                </button>
              </div>
            </div>
            <SitePreview name={name} role={ROLES.find((r) => r.role === role)?.label ?? "Portfolio"} theme={theme} avatar={user?.avatarUrl ?? null} />
          </section>
        ) : null}

        {stage === "setup" && portfolioId ? <SetupProgress portfolioId={portfolioId} name={name} theme={theme} avatar={user?.avatarUrl ?? null} /> : null}
      </main>
    </div>
  );
}

/** A miniature of the portfolio in the chosen look, so the choice is visible before anything is built. */
function SitePreview({ name, role, theme, avatar, building = false }: { name: string; role: string; theme: OnboardingTheme; avatar: string | null; building?: boolean }) {
  const dark = theme.mode === "dark";
  return (
    <div aria-hidden className="relative">
      <div className="rounded-2xl bg-stone-200/70 p-3 shadow-float ring-1 ring-stone-300/60 dark:bg-stone-800 dark:ring-stone-700">
        <div className="mb-2.5 flex gap-1.5 px-1">
          <span className="h-2.5 w-2.5 rounded-full bg-stone-400/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-stone-400/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-stone-400/60" />
        </div>
        <div className={`overflow-hidden rounded-xl p-7 transition-colors duration-300 ${dark ? "bg-stone-950 text-stone-100" : "bg-white text-stone-900"} ${building ? "animate-pulse motion-reduce:animate-none" : ""}`}>
          <div className="flex items-center gap-3">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" className="h-11 w-11 rounded-full" />
            ) : (
              <span className="h-11 w-11 rounded-full" style={{ backgroundColor: theme.accent, opacity: 0.25 }} />
            )}
            <div>
              <p className="text-lg font-semibold tracking-tight">{name}</p>
              <p className={`text-sm ${dark ? "text-stone-400" : "text-stone-500"}`}>{role}</p>
            </div>
          </div>
          <div className={`mt-5 h-2 w-4/5 rounded ${dark ? "bg-stone-800" : "bg-stone-200"}`} />
          <div className={`mt-2 h-2 w-3/5 rounded ${dark ? "bg-stone-800" : "bg-stone-200"}`} />
          <span className="mt-5 inline-block rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors duration-300" style={{ backgroundColor: theme.accent }}>
            Get in touch
          </span>
          <div className="mt-6 grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`rounded-lg p-2.5 ring-1 ${dark ? "bg-stone-900 ring-stone-800" : "bg-stone-50 ring-stone-200"}`}>
                <div className="h-1.5 w-8 rounded" style={{ backgroundColor: theme.accent, opacity: i === 0 ? 0.9 : 0.35 }} />
                <div className={`mt-2 h-1.5 w-full rounded ${dark ? "bg-stone-800" : "bg-stone-200"}`} />
                <div className={`mt-1 h-1.5 w-2/3 rounded ${dark ? "bg-stone-800" : "bg-stone-200"}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const POLL_MS = 1_500;

function SetupProgress({ portfolioId, name, theme, avatar }: { portfolioId: string; name: string; theme: OnboardingTheme; avatar: string | null }) {
  const router = useRouter();
  const [setup, setSetup] = useState<SetupStatusResponse | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      setSetup(await api.portfolioSetup(portfolioId));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) router.replace("/start");
    }
  }, [portfolioId, router]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
      setNow(Date.now());
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Opening the preview is what starts the editor if nothing else has yet; it also keeps it awake.
  const siteDone = setup?.steps.find((step) => step.id === "site")?.state === "done";
  useEffect(() => {
    if (siteDone) void api.openPreview(portfolioId).catch(() => undefined);
  }, [siteDone, portfolioId]);

  useEffect(() => {
    if (!setup?.ready) return;
    const timer = setTimeout(() => router.replace(`/portfolios/${portfolioId}?welcome=1`), setup.note ? 2_500 : 1_200);
    return () => clearTimeout(timer);
  }, [setup?.ready, setup?.note, portfolioId, router]);

  async function retry() {
    setRetrying(true);
    try {
      if (setup?.retry === "provisioning") await api.retryPortfolio(portfolioId);
      else await api.rebuildPreview(portfolioId);
      await refresh();
    } finally {
      setRetrying(false);
    }
  }

  const seconds = Math.round((now - started) / 1000);

  return (
    <section className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">{setup?.ready ? "Your portfolio is ready" : setup?.failure ? "Something got stuck" : "Building your portfolio"}</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400">
          {setup?.ready ? "Opening your editor…" : setup?.failure ?? "This usually takes under a minute. You can leave this page — we'll keep going."}
        </p>

        <ol className="mt-8 flex flex-col gap-1">
          {(setup?.steps ?? []).map((step) => (
            <li key={step.id} className="flex items-center gap-3 rounded-xl px-3 py-3">
              <StepIcon state={step.state} />
              <span className={`text-[15px] ${step.state === "pending" ? "text-stone-400" : step.state === "failed" ? "text-red-800 dark:text-red-300" : "font-medium"}`}>{step.label}</span>
              {step.state === "active" ? <span className="ml-auto text-xs text-stone-400 tabular-nums">{seconds}s</span> : null}
            </li>
          ))}
        </ol>

        {setup?.note ? <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{setup.note}</p> : null}

        {setup?.retry ? (
          <button
            onClick={() => void retry()}
            disabled={retrying}
            className="mt-6 rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-stone-700 disabled:opacity-60 dark:bg-white dark:text-stone-900"
          >
            {retrying ? "Trying again…" : "Try again"}
          </button>
        ) : null}
      </div>
      <SitePreview name={name} role="Portfolio" theme={theme} avatar={avatar} building={!setup?.ready} />
    </section>
  );
}

function StepIcon({ state }: { state: SetupStatusResponse["steps"][number]["state"] }) {
  if (state === "done") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white">
        <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5" fill="currentColor">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
        </svg>
      </span>
    );
  }
  if (state === "active") return <span className="h-6 w-6 animate-spin rounded-full border-2 border-stone-200 border-t-stone-900 motion-reduce:animate-none dark:border-stone-700 dark:border-t-white" aria-label="In progress" />;
  if (state === "failed") return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white">!</span>;
  if (state === "skipped") return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">–</span>;
  return <span className="h-6 w-6 rounded-full border-2 border-stone-200 dark:border-stone-800" />;
}
