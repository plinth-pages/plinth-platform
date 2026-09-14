import type { Metadata } from "next";
import Link from "next/link";
import { Check, DiffView, type DiffLine } from "@/components/landing/Diff";
import { ExampleSites } from "@/components/landing/ExampleSites";
import { HeroDemo } from "@/components/landing/HeroDemo";
import { NavActions } from "@/components/landing/NavActions";
import { BrandMark } from "@/components/ui/Brand";
import { ArrowRight, buttonClass } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Plinth — Your personal site, engineered by AI",
  description:
    "Describe a change in plain words. Plinth edits the real Next.js code in your site's repository, proves it compiles and renders, and ships it in one click.",
};

const STACK = ["Next.js", "TypeScript", "GitHub", "Vercel", "Resend", "LeetCode"];

const EXAMPLES: { prompt: string; file: string; lines: DiffLine[]; startLine: number; result: { ok: boolean; text: string } }[] = [
  {
    prompt: "Switch to a dark theme with a teal accent",
    file: "content/theme.ts",
    startLine: 3,
    lines: [
      [" ", "export const theme = {"],
      ["-", '  mode: "light",'],
      ["+", '  mode: "dark",'],
      ["-", '  accent: "indigo",'],
      ["+", '  accent: "teal",'],
      [" ", "} satisfies Theme;"],
    ],
    result: { ok: true, text: "3 checks passed · applied" },
  },
  {
    prompt: "Add my LeetCode stats under my projects",
    file: "app/page.tsx",
    startLine: 18,
    lines: [
      [" ", "<Projects items={site.projects} />"],
      ["+", '<LeetCodeStats username="rahul-das" />'],
      [" ", "<Experience items={site.roles} />"],
    ],
    result: { ok: true, text: "3 checks passed · applied" },
  },
  {
    prompt: "Delete the projects section",
    file: "app/page.tsx",
    startLine: 18,
    lines: [
      [" ", "<Hero profile={site.profile} />"],
      ["-", "<Projects items={site.projects} />"],
      [" ", "<Experience items={site.roles} />"],
    ],
    result: { ok: false, text: "Slots intact failed · change undone, live site untouched" },
  },
];

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#07080b] text-stone-100 [color-scheme:dark]">
      {/* Background: faint grid fading out, and a soft brand glow (gradients only — no blur filters to repaint) */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[900px] bg-[linear-gradient(to_right,rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.035)_1px,transparent_1px)] [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)] bg-[size:64px_64px]" />
      <div aria-hidden className="pointer-events-none absolute top-[-300px] left-1/2 h-[700px] w-[1100px] -translate-x-1/2 bg-[radial-gradient(closest-side,rgb(76_98_220/0.28),transparent)]" />

      <header className="relative z-10 mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <BrandMark className="h-5 w-5 text-white" />
          <span className="text-[15px] font-semibold tracking-tight">Plinth</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-stone-400 md:flex">
          <a href="#engineering" className="transition-colors hover:text-white">Under the hood</a>
          <a href="#examples" className="transition-colors hover:text-white">Examples</a>
          <a href="#pricing" className="transition-colors hover:text-white">Pricing</a>
        </nav>
        <div className="flex items-center gap-2">
          <NavActions />
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pt-16 pb-20 text-center md:pt-24">
          <a href="#engineering" className="group mx-auto inline-flex items-center gap-2 rounded-full bg-white/[0.04] py-1 pr-3 pl-1 text-[13px] text-stone-300 ring-1 ring-white/10 transition-colors hover:bg-white/[0.07]">
            <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-stone-200">tsc ✓</span>
            Every change compiled and checked before you see it
            <ArrowRight className="h-3.5 w-3.5 text-stone-500 transition-transform group-hover:translate-x-0.5" />
          </a>
          <h1 className="mx-auto mt-8 max-w-4xl bg-gradient-to-b from-white via-white to-stone-400 bg-clip-text pb-2 text-5xl leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-transparent md:text-7xl">
            Your personal site,
            <br />
            <span className="bg-gradient-to-r from-brand-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">engineered by AI.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-balance text-stone-400">
            Describe a change in plain words. Plinth edits the real Next.js code in your site&apos;s repository, proves it compiles and renders, and ships it in one click.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/login" className={buttonClass({ variant: "brand", size: "lg", className: "min-w-44" })}>
              Start building free <ArrowRight />
            </Link>
            <a href="#engineering" className={buttonClass({ variant: "glass", size: "lg", className: "min-w-44" })}>
              See how it&apos;s built
            </a>
          </div>
          <p className="mt-4 text-[13px] text-stone-500">Free plan · No card required</p>

          <div className="mt-16 md:mt-20">
            <HeroDemo />
          </div>

          <p className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-stone-500">
            <span className="text-[13px] text-stone-600">Built on</span>
            {STACK.map((name) => (
              <span key={name} className="font-medium tracking-tight text-stone-400">
                {name}
              </span>
            ))}
          </p>
        </section>

        {/* Under the hood */}
        <section id="engineering" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-24 md:py-28">
          <SectionHeading eyebrow="Under the hood" title="Not a page builder. A real codebase, handled carefully." body="The AI never gets free rein over your site. Every edit goes through the same pipeline an engineer would insist on." />
          <div className="mt-14 grid gap-4 md:grid-cols-2">
            <Tile title="Your repo, your code" body="Every site is a real Next.js and TypeScript repository on GitHub, with full history. Read it, clone it, keep it.">
              <div className="rounded-xl bg-[#08090d] p-4 font-mono text-[12px] leading-[1.8] text-stone-400 ring-1 ring-white/[0.07]">
                <p className="text-stone-300">asha/site</p>
                <p>├─ app/</p>
                <p>│&nbsp;&nbsp;├─ page.tsx</p>
                <p>│&nbsp;&nbsp;└─ api/contact/route.ts</p>
                <p>├─ components/</p>
                <p>└─ content/<span className="text-brand-300">site.ts</span></p>
                <p className="mt-2 border-t border-white/[0.06] pt-2 text-[11px] text-stone-500">
                  <span className="text-emerald-400">3f9c2a1</span> Add contact form and visitor counter
                </p>
              </div>
            </Tile>

            <Tile title="Structured edits, not guesswork" body="Integrations are installed by codemods that parse your code's syntax tree and insert components into named slots — never by blind find-and-replace.">
              <div className="rounded-xl bg-[#08090d] p-4 font-mono text-[12px] leading-[1.8] ring-1 ring-white/[0.07]">
                <p className="text-stone-500">{"// install GitHub Stats"}</p>
                <p className="text-stone-300">
                  <span className="text-violet-300">insert</span>(<span className="text-amber-200">&quot;GitHubStats&quot;</span>, {"{"}
                </p>
                <p className="pl-4 text-stone-300">
                  slot: <span className="text-amber-200">&quot;after-projects&quot;</span>,
                </p>
                <p className="pl-4 text-stone-300">
                  import: <span className="text-amber-200">&quot;@plinth-pages/github-stats&quot;</span>,
                </p>
                <p className="text-stone-300">{"})"}</p>
                <p className="mt-2 border-t border-white/[0.06] pt-2 text-[11px] text-stone-500">AST · 1 import added · 1 JSX node inserted</p>
              </div>
            </Tile>

            <Tile title="Nothing ships broken" body="Each change is staged, type-checked, validated and rendered. If any step fails, it's reverted automatically — your live site never sees it.">
              <ol className="flex flex-col gap-2 text-[13px]">
                {[
                  ["Stage change on a draft", true],
                  ["tsc --noEmit", true],
                  ["plinth check · slots and imports", true],
                  ["Render the page", true],
                ].map(([label], index) => (
                  <li key={String(label)} className="flex items-center gap-3 rounded-lg bg-white/[0.025] px-3 py-2 ring-1 ring-white/[0.06]">
                    <span className="font-mono text-[11px] text-stone-600">{index + 1}</span>
                    <span className={index === 1 || index === 2 ? "font-mono text-[12px] text-stone-300" : "text-stone-300"}>{label}</span>
                    <span className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-400">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  </li>
                ))}
                <li className="flex items-center gap-3 px-3 pt-1 text-[12px] text-stone-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" /> Any failure → automatic revert
                </li>
              </ol>
            </Tile>

            <Tile title="Keys never touch your code" body="API keys are encrypted with AES-256-GCM and delivered only to your site's server. They're kept out of your repo, your bundle and the AI's context.">
              <div className="rounded-xl bg-[#08090d] p-4 font-mono text-[12px] leading-[1.8] ring-1 ring-white/[0.07]">
                <p className="text-stone-500"># repository</p>
                <p className="text-stone-300">
                  RESEND_API_KEY=<span className="text-stone-600">(not here)</span>
                </p>
                <p className="mt-2 text-stone-500"># encrypted vault → server only</p>
                <p className="flex items-center gap-2 text-stone-300">
                  RESEND_API_KEY=<span className="tracking-widest text-brand-300">••••••••••</span>
                </p>
                <p className="mt-2 border-t border-white/[0.06] pt-2 text-[11px] text-stone-500">
                  Publish blocked if a secret appears in the build <span className="text-emerald-400">✓</span>
                </p>
              </div>
            </Tile>
          </div>
        </section>

        {/* Examples with diffs */}
        <section id="examples" className="mx-auto max-w-6xl scroll-mt-20 px-6 pb-24 md:pb-28">
          <SectionHeading eyebrow="Plain words in, reviewed code out" title="See exactly what changed." body="Every request becomes a diff you can read — and one that couldn't pass the checks never lands." />
          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            {EXAMPLES.map((example) => (
              <article key={example.prompt} className="flex flex-col gap-4 rounded-2xl bg-white/[0.025] p-5 ring-1 ring-white/[0.07]">
                <p className="self-end rounded-2xl rounded-br-md bg-white px-3 py-2 text-[13px] text-stone-900">{example.prompt}</p>
                <DiffView file={example.file} lines={example.lines} startLine={example.startLine} />
                <p className={`mt-auto flex items-center gap-2 text-[13px] ${example.result.ok ? "text-emerald-400" : "text-red-300"}`}>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${example.result.ok ? "bg-emerald-400/15" : "bg-red-400/15"}`}>
                    {example.result.ok ? <Check className="h-2.5 w-2.5" /> : <span className="text-[10px] leading-none">✕</span>}
                  </span>
                  {example.result.text}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* Example sites by role */}
        <section className="mx-auto max-w-6xl px-6 pb-24 md:pb-28">
          <SectionHeading eyebrow="Example sites" title="One template. Very different sites." body="Each of these started from the same codebase and a few sentences to the co-pilot." />
          <div className="mt-14">
            <ExampleSites />
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-6 pb-24 md:pb-28">
          <SectionHeading eyebrow="How it works" title="Live in minutes. Yours for good." />
          <ol className="mt-14 grid gap-4 md:grid-cols-3">
            {[
              { title: "Pick a role and a look", body: "We create your repository, start a live editor and fill in what we can from your GitHub profile." },
              { title: "Describe changes", body: "Ask in plain words. Each edit is checked before it appears in your preview." },
              { title: "Publish", body: "One click builds and ships to a global edge network. Keep iterating and publish again anytime." },
            ].map((step, index) => (
              <li key={step.title} className="rounded-2xl p-7 ring-1 ring-white/[0.07]">
                <span className="font-mono text-sm text-brand-300">0{index + 1}</span>
                <h3 className="mt-4 text-lg font-semibold tracking-tight text-white">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-stone-400">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-4xl scroll-mt-20 px-6 pb-24 md:pb-28">
          <SectionHeading eyebrow="Pricing" title="Start free. Upgrade when you're ready." />
          <div className="mt-14 grid gap-4 md:grid-cols-2">
            <PriceCard name="Free" price="$0" note="Everything you need to launch." features={["20 co-pilot messages a day", "Fast AI model", "Integrations & publishing", "Full safety net on every change"]} cta={<Link href="/login" className={buttonClass({ variant: "glass", size: "lg", full: true })}>Start free</Link>} />
            <PriceCard
              name="Pro"
              price="$15"
              note="For people who keep iterating."
              highlight
              features={["300 co-pilot messages a day", "Claude and GPT-4o", "5M AI tokens a month", "Everything in Free"]}
              cta={
                <Link href="/login" className={buttonClass({ variant: "brand", size: "lg", full: true })}>
                  Get Pro <ArrowRight />
                </Link>
              }
            />
          </div>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-white/[0.06] to-white/[0.01] px-8 py-16 text-center ring-1 ring-white/10 md:py-20">
            <div aria-hidden className="absolute inset-x-0 -bottom-48 mx-auto h-96 w-[760px] max-w-full bg-[radial-gradient(closest-side,rgb(76_98_220/0.35),transparent)]" />
            <h2 className="relative mx-auto max-w-2xl bg-gradient-to-b from-white to-stone-400 bg-clip-text text-4xl font-semibold tracking-[-0.035em] text-balance text-transparent md:text-5xl">Ship a site you actually own.</h2>
            <p className="relative mx-auto mt-4 max-w-md text-stone-400">Real code, checked changes, live in about a minute.</p>
            <div className="relative mt-8 flex justify-center">
              <Link href="/login" className={buttonClass({ variant: "inverse", size: "lg" })}>
                Start building free <ArrowRight />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-stone-500 md:flex-row">
          <div className="flex items-center gap-2">
            <BrandMark className="h-4 w-4 text-stone-400" />
            <span>© {new Date().getFullYear()} Plinth</span>
          </div>
          <div className="flex gap-6">
            <a href="#engineering" className="hover:text-stone-300">Under the hood</a>
            <a href="#pricing" className="hover:text-stone-300">Pricing</a>
            <Link href="/login?mode=signin" className="hover:text-stone-300">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-[13px] font-medium tracking-wide text-brand-300">{eyebrow}</p>
      <h2 className="mt-3 bg-gradient-to-b from-white to-stone-400 bg-clip-text text-4xl font-semibold tracking-[-0.035em] text-balance text-transparent md:text-5xl">{title}</h2>
      {body ? <p className="mt-4 text-lg text-balance text-stone-400">{body}</p> : null}
    </div>
  );
}

function Tile({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <article className="flex flex-col gap-6 rounded-2xl bg-white/[0.025] p-6 ring-1 ring-white/[0.07] md:p-7">
      <div>
        <h3 className="text-lg font-semibold tracking-tight text-white">{title}</h3>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-stone-400">{body}</p>
      </div>
      <div className="mt-auto">{children}</div>
    </article>
  );
}

function PriceCard({ name, price, note, features, cta, highlight = false }: { name: string; price: string; note: string; features: string[]; cta: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`relative flex flex-col rounded-2xl p-8 ${highlight ? "bg-gradient-to-b from-brand-500/[0.12] to-transparent ring-1 ring-brand-400/40" : "bg-white/[0.025] ring-1 ring-white/[0.07]"}`}>
      {highlight ? <span className="absolute top-8 right-8 rounded-full bg-brand-500/15 px-2.5 py-0.5 text-xs font-medium text-brand-200 ring-1 ring-brand-400/30">Most popular</span> : null}
      <h3 className="text-lg font-semibold text-white">{name}</h3>
      <p className="mt-1 text-sm text-stone-400">{note}</p>
      <p className="mt-6">
        <span className="text-5xl font-semibold tracking-tight text-white">{price}</span>
        <span className="text-stone-500"> / month</span>
      </p>
      <ul className="mt-8 flex flex-col gap-3 text-[15px] text-stone-300">
        {features.map((feature) => (
          <li key={feature} className="flex items-center gap-3">
            <Check className="h-4 w-4 shrink-0 text-brand-300" />
            {feature}
          </li>
        ))}
      </ul>
      <div className="mt-10">{cta}</div>
    </div>
  );
}
