"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BrandMark } from "@/components/ui/Brand";
import { ApiError, api } from "@/lib/api";

/**
 * Where sign-in lands. A new user goes to onboarding, someone whose portfolio is still being set up goes back to its
 * progress, and a returning user goes to their dashboard — never straight into the editor, which starts a sandbox.
 */
export default function StartPage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        const [{ portfolios }] = await Promise.all([api.portfolios(), api.me()]);
        if (portfolios.length === 0) return router.replace("/onboarding");
        const first = portfolios[0];
        if (first.status !== "ready") return router.replace(`/onboarding?portfolio=${first.id}`);
        const setup = await api.portfolioSetup(first.id).catch(() => null);
        if (setup && !setup.ready && setup.steps.some((step) => step.id === "personalise" && step.state === "active")) {
          return router.replace(`/onboarding?portfolio=${first.id}`);
        }
        router.replace("/dashboard");
      } catch (error) {
        router.replace(error instanceof ApiError && error.status === 401 ? "/" : "/dashboard");
      }
    })();
  }, [router]);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-5 overflow-hidden bg-white dark:bg-stone-950" aria-busy="true">
      <div aria-hidden className="absolute top-1/2 left-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(76_98_220/0.18),transparent)]" />
      <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-[0_0_0_1px_rgb(28_25_23/0.08),0_12px_32px_-12px_rgb(76_98_220/0.45)] dark:bg-stone-900 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08)]">
        <BrandMark className="h-7 w-7 text-stone-900 dark:text-white" />
      </span>
      <div className="relative flex flex-col items-center gap-2">
        <p className="text-[15px] font-medium tracking-tight">Getting things ready</p>
        <span className="flex gap-1.5" role="status" aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 motion-reduce:animate-none" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </span>
      </div>
    </main>
  );
}
