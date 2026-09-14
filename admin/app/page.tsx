import type { Metadata } from "next";
import Link from "next/link";
import { NavActions } from "@/components/landing/NavActions";
import { ProductMockup } from "@/components/landing/ProductMockup";
import { BrandMark } from "@/components/ui/Brand";
import { ArrowRight, buttonClass } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Plinth — Describe your portfolio. Watch it get built.",
  description: "An AI co-pilot that builds and edits your portfolio, checks every change before it goes live, and publishes in about a minute.",
};

const FEATURES = [
  {
    title: "A co-pilot that edits real code",
    body: "Ask for a bolder hero, a new project or a darker theme. It changes your site's actual code — not a template setting.",
    icon: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z",
    wide: true,
  },
  {
    title: "Nothing breaks your site",
    body: "Every change is type-checked and rendered first. If anything fails, it's undone automatically.",
    icon: "M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3zm-3 9l2 2 4-4",
  },
  {
    title: "Live stats in one click",
    body: "GitHub, LeetCode, a contact form, a visitor counter — added to exactly the right place.",
    icon: "M4 6h7v5H4zM13 6h7v12h-7zM4 13h7v5H4z",
  },
  {
    title: "Your keys stay yours",
    body: "API keys are encrypted and only ever reach your site's server. Never your code, never the AI.",
    icon: "M7 11V8a5 5 0 0110 0v3M5 11h14v10H5z",
  },
  {
    title: "Publish in about a minute",
    body: "One button builds, checks and ships your site to a fast global edge network.",
    icon: "M5 12h14M13 6l6 6-6 6",
    wide: true,
  },
];

const STEPS = [
  { title: "Tell us who you are", body: "Pick your role and a look. We start from your GitHub profile." },
  { title: "Shape it in conversation", body: "Describe changes in plain words. Watch them appear in your preview." },
  { title: "Publish", body: "Go live when it looks right. Keep editing; publish again anytime." },
];

// Placeholder quotes for layout — replace with real customer quotes before launch.
const QUOTES = [
  { quote: "I described the portfolio I'd been putting off for a year, and had it live before lunch.", name: "Priya R.", role: "Frontend engineer" },
  { quote: "The fact that a change can't break the site is what sold me. I just ask and keep going.", name: "Daniel K.", role: "Product designer" },
  { quote: "Adding my LeetCode stats took one click. Recruiters actually mention it now.", name: "Arjun S.", role: "CS student" },
];

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#07080b] text-stone-100 [color-scheme:dark]">
      {/* Background: faint grid fading out, and a soft brand glow */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[900px] bg-[linear-gradient(to_right,rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.035)_1px,transparent_1px)] [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)] bg-[size:64px_64px]" />
      <div aria-hidden className="pointer-events-none absolute top-[-300px] left-1/2 h-[700px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(76_98_220/0.28),transparent)]" />

      <header className="relative z-10 mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <BrandMark className="h-5 w-5 text-white" />
          <span className="text-[15px] font-semibold tracking-tight">Plinth</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-stone-400 md:flex">
          <a href="#features" className="transition-colors hover:text-white">Features</a>
          <a href="#how" className="transition-colors hover:text-white">How it works</a>
          <a href="#pricing" className="transition-colors hover:text-white">Pricing</a>
        </nav>
        <div className="flex items-center gap-2">
          <NavActions />
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pt-20 pb-16 text-center md:pt-28">
          <a href="#how" className="group mx-auto inline-flex items-center gap-2 rounded-full bg-white/[0.04] py-1 pr-3 pl-1 text-[13px] text-stone-300 ring-1 ring-white/10 transition-colors hover:bg-white/[0.07]">
            <span className="rounded-full bg-gradient-to-b from-brand-500 to-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white">New</span>
            Integrations with your own API keys
            <ArrowRight className="h-3.5 w-3.5 text-stone-500 transition-transform group-hover:translate-x-0.5" />
          </a>
          <h1 className="mx-auto mt-8 max-w-4xl bg-gradient-to-b from-white via-white to-stone-400 bg-clip-text pb-2 text-5xl leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-transparent md:text-7xl">
            Describe your portfolio.
            <br />
            <span className="bg-gradient-to-r from-brand-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">Watch it get built.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-stone-400 text-balance">
            An AI co-pilot builds and edits your site, checks every change before it goes live, and publishes it in about a minute.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/login" className={buttonClass({ variant: "brand", size: "lg", className: "min-w-44" })}>
              Start building free <ArrowRight />
            </Link>
            <a href="#how" className={buttonClass({ variant: "glass", size: "lg", className: "min-w-44" })}>
              See how it works
            </a>
          </div>
          <p className="mt-4 text-[13px] text-stone-500">Free forever plan · No card required</p>

          <div className="mt-16 md:mt-20">
            <ProductMockup />
          </div>
        </section>

        {/* Social proof strip */}
        <section className="border-y border-white/[0.06] bg-white/[0.015]">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-10 md:grid-cols-4">
            {[
              ["< 1 min", "from sign-up to your first site"],
              ["3 checks", "before every change goes live"],
              ["1 click", "to add live stats and forms"],
              ["$0", "to start, no card needed"],
            ].map(([value, label]) => (
              <div key={label}>
                <p className="bg-gradient-to-b from-white to-stone-400 bg-clip-text text-3xl font-semibold tracking-tight text-transparent">{value}</p>
                <p className="mt-1 text-sm text-stone-500">{label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-24 md:py-32">
          <SectionHeading eyebrow="Features" title="Everything a great portfolio needs." body="Built for people who'd rather ship their portfolio than wrestle with it." />
          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <article
                key={feature.title}
                className={`group relative overflow-hidden rounded-2xl bg-white/[0.025] p-7 ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.04] ${feature.wide ? "md:col-span-2" : ""}`}
              >
                <div aria-hidden className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-brand-500/10 blur-3xl transition-opacity group-hover:opacity-100 md:opacity-0" />
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-white/10 to-white/[0.02] ring-1 ring-white/10">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand-300" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={feature.icon} />
                  </svg>
                </span>
                <h3 className="mt-6 text-lg font-semibold tracking-tight text-white">{feature.title}</h3>
                <p className="mt-2 max-w-md text-[15px] leading-relaxed text-stone-400">{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-6 pb-24 md:pb-32">
          <SectionHeading eyebrow="How it works" title="From blank page to live site." />
          <ol className="mt-14 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="relative rounded-2xl p-7 ring-1 ring-white/[0.07]">
                <span className="font-mono text-sm text-brand-300">0{index + 1}</span>
                <h3 className="mt-4 text-lg font-semibold tracking-tight text-white">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-stone-400">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Testimonials */}
        <section className="mx-auto max-w-6xl px-6 pb-24 md:pb-32">
          <SectionHeading eyebrow="Loved by builders" title="People ship faster with Plinth." />
          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {QUOTES.map((item) => (
              <figure key={item.name} className="flex flex-col justify-between rounded-2xl bg-white/[0.025] p-7 ring-1 ring-white/[0.07]">
                <blockquote className="text-[15px] leading-relaxed text-stone-200">“{item.quote}”</blockquote>
                <figcaption className="mt-8 flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-500/40 to-fuchsia-500/30 text-sm font-semibold text-white ring-1 ring-white/10">{item.name[0]}</span>
                  <span>
                    <span className="block text-sm font-medium text-white">{item.name}</span>
                    <span className="block text-[13px] text-stone-500">{item.role}</span>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-4xl scroll-mt-20 px-6 pb-24 md:pb-32">
          <SectionHeading eyebrow="Pricing" title="Start free. Upgrade when you're ready." />
          <div className="mt-14 grid gap-4 md:grid-cols-2">
            <PriceCard name="Free" price="$0" note="Everything you need to launch." features={["20 co-pilot messages a day", "Fast AI model", "Integrations & publishing", "Preview while you edit"]} cta={<Link href="/login" className={buttonClass({ variant: "glass", size: "lg", full: true })}>Start free</Link>} />
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
            <div aria-hidden className="absolute inset-x-0 -bottom-40 mx-auto h-80 w-[600px] rounded-full bg-brand-500/25 blur-3xl" />
            <h2 className="relative mx-auto max-w-2xl bg-gradient-to-b from-white to-stone-400 bg-clip-text text-4xl font-semibold tracking-[-0.035em] text-balance text-transparent md:text-5xl">Your portfolio, live today.</h2>
            <p className="relative mx-auto mt-4 max-w-md text-stone-400">It takes about a minute to start. You can change everything later.</p>
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
            <a href="#features" className="hover:text-stone-300">Features</a>
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
      {body ? <p className="mt-4 text-lg text-stone-400 text-balance">{body}</p> : null}
    </div>
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
            <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-brand-300" fill="currentColor" aria-hidden>
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
            </svg>
            {feature}
          </li>
        ))}
      </ul>
      <div className="mt-10">{cta}</div>
    </div>
  );
}
