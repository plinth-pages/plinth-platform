"use client";

import type { SessionUser } from "@plinth-pages/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PlatformChecks } from "@/components/PlatformChecks";
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

  async function signOut() {
    await api.logout();
    router.replace("/");
  }

  if (!user) {
    return <main className="p-10 text-sm text-zinc-500">Loading…</main>;
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-12 px-6 py-12">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-10 w-10 rounded-full ring-1 ring-zinc-200 dark:ring-zinc-800" />
          ) : (
            <div className="h-10 w-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
          )}
          <div>
            <p className="font-medium">{user.name ?? user.githubLogin}</p>
            <p className="font-mono text-xs text-zinc-500">
              @{user.githubLogin} · {user.role}
            </p>
          </div>
        </div>
        <button
          onClick={signOut}
          className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-200 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Sign out
        </button>
      </header>

      <section>
        <PortfolioPanel />
      </section>

      {user.role === "admin" ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-xs tracking-widest text-zinc-500 uppercase">Platform setup</h2>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="font-medium">Provisioning GitHub App</p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              The worker creates repositories as a GitHub App. Create it once; its ID and private key are written to{" "}
              <code className="font-mono text-xs">backend/.env</code> automatically.
            </p>
            <a
              href={api.githubAppSetupUrl}
              className="mt-3 inline-block rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Set up GitHub App
            </a>
          </div>
          <PlatformChecks />
        </section>
      ) : null}
    </main>
  );
}
