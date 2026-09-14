"use client";

import { useEffect, useRef, useState } from "react";
import { ChangeList, Check, type Change } from "./Diff";

const PROMPT = "Add a contact form that emails me through Resend, and a visitor counter in the footer";

const CHANGES: Change[] = [
  [" ", "<Projects items={projects} />"],
  ["+", "<ContactForm />"],
  [" ", ""],
  ["-", "<Footer />"],
  ["+", "<Footer>"],
  ["+", "  <VisitorCounter />"],
  ["+", "</Footer>"],
];

const CHECKS = ["Types check", "Layout intact", "Page loads"];

/*
 * Stages: 0 typing · 1 sent, thinking · 2 reply and diff · 3–5 checks running one by one · 6 all passed · 7 preview updated.
 * One timer at a time, started only once the demo scrolls into view, and skipped entirely for reduced motion.
 */
const STAGE_MS: Record<number, number> = { 1: 900, 2: 900, 3: 600, 4: 600, 5: 600, 6: 700 };
const TYPE_MS = 26;
const FINAL = 7;

export function HeroDemo() {
  const root = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [typed, setTyped] = useState(0);
  const [stage, setStage] = useState(0);
  const [tab, setTab] = useState<"preview" | "diff" | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(PROMPT.length);
      setStage(FINAL);
      return;
    }
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!started || stage !== 0) return;
    if (typed >= PROMPT.length) {
      const id = setTimeout(() => setStage(1), 350);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setTyped((count) => count + 1), TYPE_MS);
    return () => clearTimeout(id);
  }, [started, stage, typed]);

  useEffect(() => {
    const delay = STAGE_MS[stage];
    if (!started || delay === undefined) return;
    const id = setTimeout(() => setStage((current) => current + 1), delay);
    return () => clearTimeout(id);
  }, [started, stage]);

  const replay = () => {
    setTab(null);
    setTyped(0);
    setStage(0);
    setStarted(true);
  };

  const checksDone = Math.max(0, Math.min(CHECKS.length, stage - 3));
  const running = stage >= 3 && stage < 6 ? stage - 3 : -1;
  const shownTab = tab ?? (stage >= FINAL ? "preview" : stage >= 2 ? "diff" : "preview");
  const updated = stage >= FINAL;

  return (
    <div ref={root} className="relative mx-auto w-full max-w-5xl text-left">
      <div aria-hidden className="absolute -inset-x-16 -top-16 bottom-0 -z-10 bg-[radial-gradient(55%_55%_at_50%_30%,rgb(76_98_220/0.35),transparent_70%)]" />

      <div className="overflow-hidden rounded-2xl bg-[#0c0d12] shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_40px_120px_-30px_rgb(0_0_0/0.9)]">
        {/* Title bar */}
        <div className="flex h-11 items-center gap-3 border-b border-white/[0.06] px-4">
          <div aria-hidden className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-white/10" />
            <span className="h-3 w-3 rounded-full bg-white/10" />
            <span className="h-3 w-3 rounded-full bg-white/10" />
          </div>
          <div className="mx-auto hidden h-6 items-center gap-2 rounded-md bg-white/[0.04] px-3 font-mono text-[11px] text-stone-400 ring-1 ring-white/[0.06] sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> asha.dev · Preview
          </div>
          <span className="ml-auto rounded-md bg-gradient-to-b from-brand-500 to-brand-600 px-2.5 py-1 text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2)] sm:ml-0">Publish</span>
        </div>

        <div className="grid md:grid-cols-[340px_minmax(0,1fr)]">
          {/* Co-pilot */}
          <div className="flex min-h-[420px] flex-col gap-3 border-b border-white/[0.06] p-4 md:border-r md:border-b-0">
            <p className="flex items-center gap-2 text-xs font-medium text-stone-300">
              <Spark /> Co-pilot
            </p>

            {stage >= 1 ? <p className="animate-demo-in ml-8 self-end rounded-2xl rounded-br-md bg-white px-3 py-2 text-[13px] leading-snug text-stone-900">{PROMPT}</p> : null}

            {stage === 1 ? (
              <p className="flex items-center gap-1 px-1 text-stone-500" aria-label="Thinking">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-stone-500" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </p>
            ) : null}

            {stage >= 2 ? (
              <div className="animate-demo-in flex flex-col gap-2.5">
                <p className="mr-4 rounded-2xl rounded-bl-md bg-white/[0.05] px-3 py-2.5 text-[13px] leading-relaxed text-stone-200 ring-1 ring-white/[0.06]">
                  Done — visitors can now message you from your site, and your footer shows a live visitor count.
                </p>
                <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  {["Contact form", "Visitor counter"].map((chip) => (
                    <span key={chip} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-stone-300 ring-1 ring-white/[0.08]">
                      {chip}
                    </span>
                  ))}
                  <span className="flex items-center gap-1 text-stone-500">
                    <Lock /> Key kept private
                  </span>
                </p>
              </div>
            ) : null}

            {stage >= 2 ? (
              <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
                <p className="flex items-center justify-between text-[11px] font-medium tracking-wide text-stone-400 uppercase">
                  Safety net
                  {stage >= 6 ? <span className="animate-demo-in text-[10px] tracking-normal text-emerald-400 normal-case">All clear</span> : null}
                </p>
                <ul className="mt-2 flex flex-col gap-1.5 text-[12px]">
                  {CHECKS.map((item, index) => {
                    const done = index < checksDone;
                    const active = index === running;
                    return (
                      <li key={item} className={`flex items-center gap-2 transition-colors ${done ? "text-stone-200" : "text-stone-500"}`}>
                        <span className={`flex h-4 w-4 items-center justify-center rounded-full ${done ? "bg-emerald-400/15 text-emerald-400" : "ring-1 ring-white/10"}`}>
                          {done ? <Check className="h-2.5 w-2.5" /> : active ? <span className="h-2.5 w-2.5 animate-spin rounded-full border border-stone-400 border-t-transparent" /> : null}
                        </span>
                        {item}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className="mt-auto flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5 text-[12px] ring-1 ring-white/[0.06]">
              <span className="min-w-0 flex-1 truncate">
                {stage === 0 && typed > 0 ? (
                  <span className="text-stone-200">
                    {PROMPT.slice(0, typed)}
                    <span className="ml-px inline-block h-3.5 w-px translate-y-0.5 bg-stone-300" />
                  </span>
                ) : (
                  <span className="text-stone-500">Describe a change…</span>
                )}
              </span>
              {updated ? (
                <button type="button" onClick={replay} className="rounded-md px-1.5 py-0.5 text-[11px] text-stone-400 ring-1 ring-white/10 hover:text-white">
                  Replay
                </button>
              ) : null}
              <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-stone-900">↑</span>
            </div>
          </div>

          {/* Output */}
          <div className="flex min-w-0 flex-col bg-[radial-gradient(120%_80%_at_100%_0%,rgb(76_98_220/0.1),transparent_60%)]">
            <div role="tablist" aria-label="Output" className="flex gap-1 border-b border-white/[0.06] px-3 pt-2">
              {(["preview", "diff"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={shownTab === id}
                  onClick={() => setTab(id)}
                  className={`-mb-px border-b-2 px-3 pb-2 text-xs font-medium transition-colors ${shownTab === id ? "border-brand-400 text-white" : "border-transparent text-stone-500 hover:text-stone-300"}`}
                >
                  {id === "preview" ? "Preview" : "Changes"}
                  {id === "diff" && stage >= 2 ? <span className="ml-1.5 font-mono text-[10px] text-emerald-400">+4 −1</span> : null}
                </button>
              ))}
            </div>

            <div className="flex-1 p-3 md:p-5">
              {shownTab === "diff" ? (
                stage >= 2 ? (
                  <ChangeList title="Homepage" changes={CHANGES} stagger code />
                ) : (
                  <p className="p-6 text-center text-sm text-stone-500">No changes yet.</p>
                )
              ) : (
                <SitePreview updated={updated} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const PROJECTS = [
  { name: "ledger-kit", about: "Double-entry ledger for payment teams", tags: ["Go", "Postgres"], stars: "1.2k", tint: "from-indigo-500 to-violet-500" },
  { name: "tracequery", about: "SQL over distributed traces", tags: ["Rust", "ClickHouse"], stars: "684", tint: "from-emerald-500 to-teal-500" },
  { name: "envseal", about: "Encrypted env files for small teams", tags: ["TypeScript"], stars: "231", tint: "from-amber-500 to-orange-500" },
];

/**
 * The site the co-pilot is editing: a believable portfolio with real copy. The right-hand card swaps from "Now" to the
 * new contact form, so the preview keeps its height and nothing below it jumps.
 */
function SitePreview({ updated }: { updated: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl bg-[#fbfaf7] text-stone-900 shadow-[0_20px_60px_-20px_rgb(0_0_0/0.6)]">
      {/* Site nav */}
      <div className="flex items-center gap-3 border-b border-stone-200/80 px-4 py-2.5 text-[10px]">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-stone-900 text-[9px] font-bold text-white">AM</span>
        <span className="hidden gap-3 text-stone-500 sm:flex">
          <span className="text-stone-900">Work</span>
          <span>Writing</span>
          <span>About</span>
        </span>
        <span className="ml-auto flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-600/15">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Open to consulting
        </span>
      </div>

      <div className="bg-[radial-gradient(90%_70%_at_100%_0%,rgb(99_102_241/0.10),transparent_60%)] px-4 pt-4 pb-3 sm:px-5">
        {/* Intro */}
        <div className="flex items-start gap-3">
          <span className="relative h-11 w-11 shrink-0 rounded-full bg-gradient-to-br from-indigo-400 via-violet-400 to-fuchsia-400 ring-2 ring-white">
            <span className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-white">A</span>
          </span>
          <div className="min-w-0">
            <p className="text-[9px] font-medium tracking-[0.08em] text-stone-500 uppercase">Asha Menon · Backend engineer · Bengaluru</p>
            <p className="mt-0.5 text-[17px] leading-[1.15] font-bold tracking-[-0.02em] text-balance">I build payment systems that stay calm under load.</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 divide-x divide-stone-200 rounded-lg bg-white/80 py-2 text-center ring-1 ring-stone-200/80">
          {[
            ["8 yrs", "building backends"],
            ["2.1k", "GitHub stars"],
            ["40M", "requests a day"],
          ].map(([value, label]) => (
            <div key={label}>
              <p className="text-[13px] font-bold tabular-nums">{value}</p>
              <p className="text-[9px] text-stone-500">{label}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 grid gap-2.5 sm:grid-cols-5">
          {/* Selected work */}
          <div className="flex flex-col gap-1.5 sm:col-span-3">
            <p className="text-[9px] font-semibold tracking-[0.08em] text-stone-500 uppercase">Selected work</p>
            {PROJECTS.map((project) => (
              <div key={project.name} className="flex items-center gap-2.5 rounded-lg bg-white p-2 ring-1 ring-stone-200/80">
                <span className={`h-7 w-7 shrink-0 rounded-md bg-gradient-to-br ${project.tint}`} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold">
                    {project.name}
                    <span className="font-normal text-stone-400">★ {project.stars}</span>
                  </p>
                  <p className="truncate text-[9.5px] text-stone-500">{project.about}</p>
                </div>
                <span className="hidden gap-1 md:flex">
                  {project.tags.map((tag) => (
                    <span key={tag} className="rounded bg-stone-100 px-1.5 py-0.5 text-[8.5px] font-medium text-stone-600">
                      {tag}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>

          {/* Now → contact form */}
          <div className="flex flex-col sm:col-span-2">
            <p className="flex items-center justify-between text-[9px] font-semibold tracking-[0.08em] text-stone-500 uppercase">
              {updated ? "Get in touch" : "Now"}
              {updated ? <span className="rounded-full bg-indigo-50 px-1.5 py-px text-[8.5px] font-medium tracking-normal text-indigo-700 normal-case">New</span> : null}
            </p>
            {updated ? (
              <div className="animate-demo-in mt-1.5 flex flex-1 flex-col gap-1.5 rounded-lg bg-white p-2 ring-2 ring-indigo-400/60">
                <Input label="Name" value="Priya Shah" />
                <Input label="Email" value="priya@studio.co" />
                <div className="flex-1 rounded-md bg-stone-50 px-2 py-1.5 ring-1 ring-stone-200">
                  <p className="text-[8px] text-stone-400">Message</p>
                  <p className="text-[9.5px] leading-snug text-stone-700">Loved ledger-kit. Could we chat about our payouts?</p>
                </div>
                <span className="flex h-6 items-center justify-center rounded-md bg-stone-900 text-[9.5px] font-medium text-white">Send message →</span>
              </div>
            ) : (
              <div className="mt-1.5 flex flex-1 flex-col gap-2 rounded-lg bg-white p-2.5 ring-1 ring-stone-200/80">
                <p className="text-[10.5px] leading-snug text-stone-700">Staff engineer on a payments platform, moving money for 3M merchants.</p>
                <p className="text-[10.5px] leading-snug text-stone-700">Writing about idempotency and the art of safe retries.</p>
                <p className="mt-auto text-[9.5px] text-stone-400">Updated this week</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-stone-200/80 px-4 py-2 text-[9.5px] text-stone-500 sm:px-5">
        <span>© 2026 Asha Menon</span>
        {updated ? (
          <span className="animate-demo-in flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-stone-700 ring-2 ring-indigo-400/60">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> <span className="font-semibold tabular-nums">1,284</span> visitors this month
          </span>
        ) : (
          <span className="flex gap-3">
            <span>GitHub</span>
            <span>LinkedIn</span>
          </span>
        )}
      </div>
    </div>
  );
}

function Input({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-stone-50 px-2 py-1 ring-1 ring-stone-200">
      <p className="text-[8px] text-stone-400">{label}</p>
      <p className="truncate text-[9.5px] text-stone-700">{value}</p>
    </div>
  );
}

function Spark() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-brand-400" fill="currentColor" aria-hidden>
      <path d="M8 1.5a.5.5 0 0 1 .47.33l1.2 3.3a1.5 1.5 0 0 0 .9.9l3.3 1.2a.5.5 0 0 1 0 .94l-3.3 1.2a1.5 1.5 0 0 0-.9.9l-1.2 3.3a.5.5 0 0 1-.94 0l-1.2-3.3a1.5 1.5 0 0 0-.9-.9l-3.3-1.2a.5.5 0 0 1 0-.94l3.3-1.2a1.5 1.5 0 0 0 .9-.9l1.2-3.3A.5.5 0 0 1 8 1.5Z" />
    </svg>
  );
}

function Lock() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 text-brand-300" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
