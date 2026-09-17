import Link from "next/link";
import { BrandMark } from "@/components/ui/Brand";

export const LEGAL_UPDATED = "17 September 2026";

export interface LegalSection {
  id: string;
  title: string;
  body: React.ReactNode;
}

/** Header and footer shared by the legal pages. */
export function LegalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-stone-800 dark:bg-stone-950 dark:text-stone-300">
      <header className="sticky top-0 z-10 border-b border-stone-200/80 bg-white/85 backdrop-blur dark:border-stone-800 dark:bg-stone-950/85">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <BrandMark className="h-5 w-5" />
            <span className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-white">Plinth</span>
          </Link>
          <nav className="flex gap-5 text-sm text-stone-500">
            <Link href="/terms" className="hover:text-stone-900 dark:hover:text-white">Terms</Link>
            <Link href="/privacy" className="hover:text-stone-900 dark:hover:text-white">Privacy</Link>
            <Link href="/privacy/request" className="hover:text-stone-900 dark:hover:text-white">Contact</Link>
          </nav>
        </div>
      </header>

      {children}

      <footer className="border-t border-stone-200 dark:border-stone-800">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 py-8 text-sm text-stone-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Plinth</span>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link href="/about" className="hover:text-stone-900 dark:hover:text-white">About</Link>
            <Link href="/terms" className="hover:text-stone-900 dark:hover:text-white">Terms</Link>
            <Link href="/privacy" className="hover:text-stone-900 dark:hover:text-white">Privacy</Link>
            <Link href="/privacy/request" className="hover:text-stone-900 dark:hover:text-white">Contact</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** /terms and /privacy: a readable document with a sticky contents list. */
export function LegalDoc({ title, summary, sections }: { title: string; summary: React.ReactNode; sections: LegalSection[] }) {
  return (
    <LegalShell>
      <main className="mx-auto grid min-w-0 max-w-6xl gap-12 px-6 py-14 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav aria-label="Contents" className="sticky top-24 flex flex-col gap-1.5 text-[13px]">
            <p className="mb-1 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">Contents</p>
            {sections.map((section, index) => (
              <a key={section.id} href={`#${section.id}`} className="text-stone-500 hover:text-stone-900 dark:hover:text-white">
                {index + 1}. {section.title}
              </a>
            ))}
          </nav>
        </aside>

        <article className="min-w-0 max-w-[72ch]">
          <p className="text-[13px] font-medium text-brand-600 dark:text-brand-300">Last updated {LEGAL_UPDATED}</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.035em] text-stone-900 dark:text-white">{title}</h1>
          <div className="mt-6 rounded-2xl bg-stone-50 p-5 text-[15px] leading-relaxed ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800">{summary}</div>

          {sections.map((section, index) => (
            <section key={section.id} id={section.id} className="mt-12 scroll-mt-24">
              <h2 className="text-xl font-semibold tracking-tight text-stone-900 dark:text-white">
                {index + 1}. {section.title}
              </h2>
              <div className="mt-3 flex flex-col gap-3 text-[15px] leading-7 [&_a]:font-medium [&_a]:text-brand-700 [&_a]:underline [&_a]:underline-offset-2 dark:[&_a]:text-brand-300 [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-stone-900 dark:[&_strong]:text-white">
                {section.body}
              </div>
            </section>
          ))}
        </article>
      </main>
    </LegalShell>
  );
}
