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
    <main className="flex min-h-screen items-center justify-center" aria-busy="true">
      <BrandMark className="h-7 w-7 animate-pulse text-stone-400 motion-reduce:animate-none" />
    </main>
  );
}
