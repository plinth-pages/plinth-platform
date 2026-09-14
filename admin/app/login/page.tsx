import type { Metadata } from "next";
import Link from "next/link";
import { AuthForms } from "@/components/AuthForms";
import { RedirectIfSignedIn } from "@/components/RedirectIfSignedIn";
import { BrandMark } from "@/components/ui/Brand";
import { api } from "@/lib/api";

export const metadata: Metadata = { title: "Sign in · Plinth" };

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
          <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.035em] text-balance">{mode === "signin" ? "Welcome back" : "Build your portfolio in minutes"}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-stone-500 dark:text-stone-400">
            {mode === "signin" ? "Sign in to keep editing your site." : "Create a free account. No card, no confirmation email — you're in straight away."}
          </p>

          {auth_error ? (
            <p role="alert" className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900">
              {auth_error}
            </p>
          ) : null}

          <AuthForms githubUrl={api.signInUrl} initialMode={mode === "signin" ? "signin" : "signup"} />

          <p className="mt-8 text-center text-xs leading-relaxed text-stone-400">By continuing you agree to use Plinth responsibly. Your code and keys stay yours.</p>
        </div>
      </section>

      <section aria-hidden className="relative hidden overflow-hidden bg-[#07080b] lg:block">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.04)_1px,transparent_1px)] [mask-image:radial-gradient(60%_60%_at_60%_40%,black,transparent)] bg-[size:56px_56px]" />
        <div className="absolute top-1/3 left-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(76_98_220/0.4),transparent)]" />

        <div className="relative flex h-full flex-col justify-center px-16">
          <div className="max-w-md rounded-2xl bg-white/[0.04] p-5 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.8)] ring-1 ring-white/10 backdrop-blur">
            <div className="ml-10 rounded-2xl rounded-br-md bg-white px-3.5 py-2.5 text-sm text-stone-900">Make my hero bolder and add my LeetCode stats</div>
            <div className="mt-3 mr-10 rounded-2xl rounded-bl-md bg-white/[0.06] px-3.5 py-2.5 text-sm text-stone-200 ring-1 ring-white/10">Done. Your headline is heavier and LeetCode Stats sits under your projects.</div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {["Types check", "Layout intact", "Page loads"].map((check) => (
                <span key={check} className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-emerald-300 ring-1 ring-emerald-400/20">✓ {check}</span>
              ))}
            </div>
          </div>
          <p className="mt-10 max-w-md bg-gradient-to-b from-white to-stone-400 bg-clip-text text-3xl leading-tight font-semibold tracking-[-0.03em] text-transparent">Every change checked before it reaches your site.</p>
          <p className="mt-3 max-w-md text-stone-400">Describe what you want. Plinth writes it, tests it, and only then shows it.</p>
        </div>
      </section>
    </main>
  );
}
