import { BrandMark } from "@/components/ui/Brand";
import { api } from "@/lib/api";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ auth_error?: string }> }) {
  const { auth_error } = await searchParams;

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="flex flex-col justify-between px-8 py-10 sm:px-14">
        <div className="flex items-center gap-2">
          <BrandMark className="h-6 w-6" />
          <span className="text-lg font-semibold tracking-tight">Plinth</span>
        </div>

        <div className="mx-auto w-full max-w-sm py-16">
          <h1 className="text-4xl font-semibold tracking-tight text-balance">Describe your portfolio. Watch it get built.</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
            Tell the co-pilot what you want, add live stats from the places you work, and publish when it looks right.
          </p>

          {auth_error ? (
            <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{auth_error}</p>
          ) : null}

          <a
            href={api.signInUrl}
            className="mt-8 flex h-11 items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 text-sm font-medium text-white shadow-card transition-colors hover:bg-stone-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="currentColor">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            Continue with GitHub
          </a>
          <p className="mt-3 text-center text-xs text-stone-500">Free to start. No card required.</p>
        </div>

        <p className="text-xs text-stone-400">© {new Date().getFullYear()} Plinth</p>
      </section>

      <section aria-hidden className="relative hidden overflow-hidden bg-stone-900 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgb(76_98_220/0.35),transparent_60%)]" />
        <div className="absolute top-1/2 left-1/2 w-[440px] -translate-x-1/2 -translate-y-1/2">
          <div className="rounded-2xl bg-stone-800/80 p-4 shadow-float ring-1 ring-white/10">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-stone-600" />
              <span className="h-2.5 w-2.5 rounded-full bg-stone-600" />
              <span className="h-2.5 w-2.5 rounded-full bg-stone-600" />
            </div>
            <div className="mt-4 rounded-xl bg-stone-50 p-6">
              <div className="h-3 w-24 rounded bg-stone-300" />
              <div className="mt-3 h-6 w-56 rounded bg-stone-800" />
              <div className="mt-2 h-3 w-64 rounded bg-stone-300" />
              <div className="mt-6 grid grid-cols-3 gap-2">
                <div className="h-16 rounded-lg bg-stone-200" />
                <div className="h-16 rounded-lg bg-stone-200" />
                <div className="h-16 rounded-lg bg-brand-100" />
              </div>
            </div>
          </div>
          <div className="absolute -bottom-10 -left-10 w-64 rounded-xl bg-white p-3 text-[13px] text-stone-800 shadow-float">
            <p className="text-stone-500">You</p>
            <p className="mt-0.5">Add my LeetCode stats under my projects</p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Added and checked
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
