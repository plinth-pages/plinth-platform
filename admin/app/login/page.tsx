import type { Metadata } from "next";
import Link from "next/link";
import { AuthForms } from "@/components/AuthForms";
import { RedirectIfSignedIn } from "@/components/RedirectIfSignedIn";
import { RestingNotice } from "@/components/RestingNotice";
import { BrandMark } from "@/components/ui/Brand";
import { api } from "@/lib/api";

export const metadata: Metadata = { title: "Sign in · Plinth" };

const DIFF: [" " | "+", string][] = [
  [" ", "<Projects items={projects} />"],
  ["+", "<ContactForm />"],
  [" ", "<Footer>"],
  ["+", "  <VisitorCounter />"],
  [" ", "</Footer>"],
];

const CHECKS = ["Types check", "Layout intact", "Page loads"];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ auth_error?: string; mode?: string }> }) {
  const { auth_error, mode } = await searchParams;

  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] dark:bg-stone-950">
      {auth_error ? null : <RedirectIfSignedIn />}

      <section className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" className="flex w-fit items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none">
          <BrandMark className="h-5 w-5" />
          <span className="text-[15px] font-semibold tracking-tight">Plinth</span>
        </Link>

        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-12">
          <RestingNotice className="mt-0 mb-6" />
          <AuthForms githubUrl={api.signInUrl} initialMode={mode === "signin" ? "signin" : "signup"} notice={auth_error} />
          <p className="mt-10 text-center text-xs leading-relaxed text-stone-400">
            <Link href="/terms" className="hover:text-stone-600 dark:hover:text-stone-200">Terms</Link> ·{" "}
            <Link href="/privacy" className="hover:text-stone-600 dark:hover:text-stone-200">Privacy</Link> ·{" "}
            <Link href="/privacy/request" className="hover:text-stone-600 dark:hover:text-stone-200">Privacy requests</Link>
          </p>
        </div>
      </section>

      <section aria-hidden className="relative hidden overflow-hidden bg-[#07080b] lg:block">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.04)_1px,transparent_1px)] [mask-image:radial-gradient(60%_60%_at_60%_40%,black,transparent)] bg-[size:56px_56px]" />
        <div className="absolute top-1/3 left-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(76_98_220/0.4),transparent)]" />

        <div className="relative flex h-full flex-col justify-center px-16">
          <div className="max-w-md rounded-2xl bg-white/[0.04] p-5 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.8)] ring-1 ring-white/10">
            <div className="ml-10 rounded-2xl rounded-br-md bg-white px-3.5 py-2.5 text-sm text-stone-900">
              Add a contact form that emails me through Resend, and a live visitor counter in the footer
            </div>
            <div className="mt-3 mr-8 rounded-2xl rounded-bl-md bg-white/[0.06] px-3.5 py-2.5 text-sm leading-relaxed text-stone-200 ring-1 ring-white/10">
              Shipped. Two components wired in, your key sealed server-side, and nothing else on the page touched.
            </div>

            <div className="mt-4 overflow-hidden rounded-xl bg-[#08090d] ring-1 ring-white/[0.07]">
              <p className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5 text-[11px] text-stone-500">
                Homepage <span className="font-mono text-emerald-400">+2</span>
              </p>
              <div className="py-1 font-mono text-[12px] leading-[1.8] whitespace-pre">
                {DIFF.map(([mark, code], index) => (
                  <div key={index} className={`flex gap-2 px-3 ${mark === "+" ? "bg-emerald-400/[0.08] text-emerald-200" : "text-stone-500"}`}>
                    <span className={`w-3 ${mark === "+" ? "text-emerald-400" : ""}`}>{mark === "+" ? "+" : ""}</span>
                    {code}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {CHECKS.map((check) => (
                <span key={check} className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-emerald-300 ring-1 ring-emerald-400/20">
                  ✓ {check}
                </span>
              ))}
              <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-stone-400 ring-1 ring-white/10">Live in 38s</span>
            </div>
          </div>

          <p className="mt-10 max-w-md bg-gradient-to-b from-white to-stone-400 bg-clip-text text-3xl leading-tight font-semibold tracking-[-0.03em] text-transparent">
            Every change compiled, verified and reversible.
          </p>
          <p className="mt-3 max-w-md text-stone-400">
            You describe the outcome. Plinth writes typed React, proves it builds and renders, and only then ships it — to code you own.
          </p>
          <div className="mt-8 grid max-w-md grid-cols-3 gap-4 border-t border-white/[0.08] pt-6">
            {[
              ["Typed", "React + TypeScript"],
              ["Checked", "before every preview"],
              ["Owned", "every line is yours"],
            ].map(([value, label]) => (
              <div key={value}>
                <p className="text-sm font-semibold text-white">{value}</p>
                <p className="mt-0.5 text-xs text-stone-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
