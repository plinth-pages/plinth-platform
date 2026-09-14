"use client";

import type { SessionUser } from "@plinth-pages/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { PortfolioPanel } from "@/components/PortfolioPanel";
import { ApiError, api } from "@/lib/api";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) router.replace("/");
      });
  }, [router]);

  if (!user) return <main className="min-h-screen" aria-busy="true" />;

  const firstName = (user.name ?? user.githubLogin).split(" ")[0];

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Welcome back, {firstName}</h1>
          <p className="mt-1.5 text-stone-600 dark:text-stone-400">Pick up where you left off.</p>
        </div>
        <PortfolioPanel />
      </main>
    </div>
  );
}
