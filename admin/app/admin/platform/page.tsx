"use client";

import { PlatformChecks } from "@/components/PlatformChecks";
import { api } from "@/lib/api";

/** Operator setup and wiring checks. Only reachable inside the admin console. */
export default function PlatformPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Platform</h1>
        <p className="mt-1 text-sm text-stone-500">One-time setup and wiring checks for the api, worker and queue.</p>
      </header>
      <section className="rounded-2xl bg-white p-5 text-sm shadow-card ring-1 ring-stone-200/80 dark:bg-stone-900 dark:ring-stone-800">
        <h2 className="font-medium">Provisioning GitHub App</h2>
        <p className="mt-1 text-stone-600 dark:text-stone-400">
          The worker creates portfolio repositories as a GitHub App. Create it once; its ID and private key are written to{" "}
          <code className="font-mono text-xs">backend/.env</code>.
        </p>
        <a href={api.githubAppSetupUrl} className="mt-3 inline-block rounded-lg bg-stone-900 px-3 py-1.5 font-medium text-white hover:bg-stone-700 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200">
          Set up GitHub App
        </a>
      </section>
      <PlatformChecks />
    </div>
  );
}
