import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "@/components/landing/Diff";
import { ExampleWork } from "@/components/landing/ExampleWork";
import { ExampleSites } from "@/components/landing/ExampleSites";
import { HeroDemo } from "@/components/landing/HeroDemo";
import { NavActions } from "@/components/landing/NavActions";
import { BrandMark } from "@/components/ui/Brand";
import { ArrowRight, buttonClass } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Plinth — Describe what you do. Watch it get built.",
  description: "Real React code engineered by AI, type-checked for safety, and deployed in seconds. You own every line.",
};

const CONNECTS = ["GitHub", "LeetCode", "Resend", "Contact forms", "Visitor analytics"];

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
            <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">✓ Safe</span>
            Every change checked before you see it
            <ArrowRight className="h-3.5 w-3.5 text-stone-500 transition-transform group-hover:translate-x-0.5" />
          </a>
          <h1 className="mx-auto mt-8 max-w-4xl bg-gradient-to-b from-white via-white to-stone-400 bg-clip-text pb-2 text-5xl leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-transparent md:text-7xl">
            Describe what you do.
            <br />
            <span className="bg-gradient-to-r from-brand-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">Watch it get built.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-balance text-stone-400">
            Real React code engineered by AI, type-checked for safety, and deployed in seconds. You own every line.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/login" className={buttonClass({ variant: "brand", size: "lg", className: "min-w-44" })}>
              Start building free <ArrowRight />
            </Link>
            <a href="#engineering" className={buttonClass({ variant: "glass", size: "lg", className: "min-w-44" })}>
              Under the hood
            </a>
          </div>
          <p className="mt-4 text-[13px] text-stone-500">Free plan · No card required</p>

          <div className="mt-16 md:mt-20">
            <HeroDemo />
          </div>

          <p className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-stone-500">
            <span className="text-[13px] text-stone-600">Connect</span>
            {CONNECTS.map((name) => (
              <span key={name} className="font-medium tracking-tight text-stone-400">
                {name}
              </span>
            ))}
          </p>
        </section>

        {/* Under the hood */}
        <section id="engineering" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-24 md:py-28">
          <SectionHeading eyebrow="Under the hood" title="Real code. Handled carefully." body="The AI never gets free rein over your site. Every change is checked, saved and reversible." />
          <div className="mt-14 grid gap-4 md:grid-cols-2">
            <Tile title="You own every line" body="Your site is standard React code, not a locked template. Every change is saved, so you can always see what changed and when.">
              <ol className="flex flex-col gap-1.5 text-[13px]">
                {[
                  ["Added a contact form", "2 min ago"],
                  ["Switched to a darker theme", "Yesterday"],
                  ["Added LeetCode stats", "Monday"],
                ].map(([label, when], index) => (
                  <li key={label} className="flex items-center gap-3 rounded-lg bg-white/[0.025] px-3 py-2 ring-1 ring-white/[0.06]">
                    <span className={`h-2 w-2 rounded-full ${index === 0 ? "bg-brand-400" : "bg-stone-600"}`} />
                    <span className="text-stone-300">{label}</span>
                    <span className="ml-auto text-[12px] text-stone-500">{when}</span>
                  </li>
                ))}
              </ol>
            </Tile>

            <Tile title="Precise, not guesswork" body="Plinth changes exactly what you asked for and leaves the rest of your site alone. Integrations drop into the right place every time.">
              <div className="rounded-xl bg-[#f7f7f5] p-4 text-stone-900">
                <div className="h-2 w-24 rounded bg-stone-300" />
                <div className="mt-2 h-1.5 w-40 rounded bg-stone-200" />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-8 rounded-md bg-white ring-1 ring-stone-200" />
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between rounded-md bg-white px-3 py-2 ring-2 ring-brand-400/70">
                  <span className="text-[11px] font-semibold">GitHub stats</span>
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700">Added here</span>
                </div>
              </div>
            </Tile>

            <Tile title="Type-checked for safety" body="Before any change reaches your preview, it's type-checked and tested. If anything is off, the change is undone automatically.">
              <ol className="flex flex-col gap-1.5 text-[13px]">
                {["Types check", "Layout intact", "Page loads"].map((label) => (
                  <li key={label} className="flex items-center gap-3 rounded-lg bg-white/[0.025] px-3 py-2 ring-1 ring-white/[0.06]">
                    <span className="text-stone-300">{label}</span>
                    <span className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-400">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  </li>
                ))}
                <li className="flex items-center gap-2 px-3 pt-1 text-[12px] text-stone-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" /> Anything fails → undone automatically
                </li>
              </ol>
            </Tile>

            <Tile title="Your keys stay private" body="Keys you add for integrations are encrypted and never appear on your site, in your code, or in anything the AI sees.">
              <div className="flex flex-col gap-2">
                {[
                  ["Resend", "Contact form"],
                  ["Visitor counter", "Analytics"],
                ].map(([name, use]) => (
                  <div key={name} className="flex items-center gap-3 rounded-lg bg-white/[0.025] px-3 py-2.5 ring-1 ring-white/[0.06]">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-[12px] font-semibold text-stone-200 ring-1 ring-white/10">{name[0]}</span>
                    <span>
                      <span className="block text-[13px] text-stone-200">{name}</span>
                      <span className="block text-[11px] text-stone-500">{use}</span>
                    </span>
                    <span className="ml-auto flex items-center gap-1.5 text-[12px] text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Connected · private
                    </span>
                  </div>
                ))}
              </div>
            </Tile>
          </div>
        </section>

        {/* Examples */}
        <section id="examples" className="mx-auto max-w-6xl scroll-mt-20 px-6 pb-24 md:pb-28">
          <SectionHeading eyebrow="Plain words in, real code out" title="Real work, reviewed line by line." body="Integrations wired in, live data pulled, themes rebuilt — every request becomes code you can read, and anything unsafe is stopped before it ships." />
          <div className="mt-14">
            <ExampleWork />
          </div>
        </section>

        {/* Example sites by role */}
        <section className="mx-auto max-w-6xl px-6 pb-24 md:pb-28">
          <SectionHeading eyebrow="Example sites" title="One template. Very different sites." body="Each of these started from the same place and a few sentences to the co-pilot." />
          <div className="mt-14">
            <ExampleSites />
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-6 pb-24 md:pb-28">
          <SectionHeading eyebrow="How it works" title="Live in minutes. Yours for good." />
          <ol className="mt-14 grid gap-4 md:grid-cols-3">
            {[
              { title: "Pick a role and a look", body: "We set up your site and fill in what we can from your GitHub profile." },
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
            <p className="relative mx-auto mt-4 max-w-md text-stone-400">Real React code, checked changes, live in seconds.</p>
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
            <Link href="/terms" className="hover:text-stone-300">Terms</Link>
            <Link href="/privacy" className="hover:text-stone-300">Privacy</Link>
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
