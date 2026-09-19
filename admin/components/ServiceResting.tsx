import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";

/**
 * What someone sees when the part of Plinth that builds sites can't be reached.
 *
 * Plinth is one person's side project on free hosting, and free hosting ends. When it does, this page is still
 * served, so the choice is between a screen of broken spinners and an honest note. The note also answers the
 * question anyone who built a site here will actually have: is my site gone? It isn't — portfolios live in their
 * own repositories and deploy from them, so they outlive this.
 *
 * Names no host or vendor: which companies run which piece is not something a visitor needs, and public pages
 * don't advertise the plumbing.
 */
export function ServiceResting({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/20">
        Plinth&apos;s build service is resting — this is a side project on free hosting, and it ran out.{" "}
        <Link href="/about" className="font-medium underline underline-offset-2">
          What this means
        </Link>
      </p>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center gap-5 px-6 py-16 text-center">
      <p aria-hidden className="text-4xl">
        🌙
      </p>
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900 dark:text-white">Plinth is having a lie-down</h1>
      <p className="text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        This is a side project, built by one person and run on free hosting. The part that writes code and builds previews has
        gone to sleep — so you can read about Plinth, but you can&apos;t make a site with it today.
      </p>
      <p className="text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        <strong className="font-semibold text-stone-900 dark:text-stone-100">If you built a site here, it&apos;s fine.</strong> Every
        portfolio Plinth made is real Next.js code in your own repository, deployed from it. Your site and your code carry on
        without any of this.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
        <a href="https://github.com/plinth-pages" target="_blank" rel="noreferrer" className={buttonClass({ variant: "brand", size: "lg" })}>
          See how it was built
        </a>
        <Link href="/about" className={buttonClass({ variant: "glass", size: "lg" })}>
          About Plinth
        </Link>
      </div>
      <p className="pt-2 text-xs text-stone-500">Thanks for stopping by.</p>
    </div>
  );
}
