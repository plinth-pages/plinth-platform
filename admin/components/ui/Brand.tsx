import Link from "next/link";

/** The Plinth mark: a column resting on its base. */
export function BrandMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <rect x="8" y="3" width="8" height="12" rx="1.5" opacity="0.55" />
      <rect x="5" y="16" width="14" height="2.5" rx="1" />
      <rect x="3" y="19.5" width="18" height="2.5" rx="1" />
    </svg>
  );
}

export function Brand({ href = "/dashboard", suffix }: { href?: string; suffix?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-md px-1 py-0.5 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none">
      <BrandMark className="h-5 w-5 text-stone-900 dark:text-stone-100" />
      <span className="text-[15px] font-semibold tracking-tight">Plinth</span>
      {suffix ? <span className="rounded bg-stone-900 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase dark:bg-stone-100 dark:text-stone-900">{suffix}</span> : null}
    </Link>
  );
}
