import { AuthForms } from "@/components/AuthForms";
import { RedirectIfSignedIn } from "@/components/RedirectIfSignedIn";
import { BrandMark } from "@/components/ui/Brand";
import { api } from "@/lib/api";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ auth_error?: string }> }) {
  const { auth_error } = await searchParams;

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {auth_error ? null : <RedirectIfSignedIn />}
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

          <AuthForms githubUrl={api.signInUrl} />
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
