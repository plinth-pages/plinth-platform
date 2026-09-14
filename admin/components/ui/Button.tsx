import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "brand" | "secondary" | "ghost" | "inverse" | "glass";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-medium tracking-[-0.01em] transition-[background-color,box-shadow,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-stone-900 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(0_0_0/0.2)] hover:bg-stone-800 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200",
  brand:
    "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_0_0_1px_rgb(47_63_166/0.9),0_8px_24px_-8px_rgb(76_98_220/0.65)] hover:from-brand-400 hover:to-brand-600",
  secondary:
    "bg-white text-stone-900 shadow-[0_0_0_1px_rgb(28_25_23/0.1),0_1px_2px_rgb(28_25_23/0.06)] hover:bg-stone-50 dark:bg-stone-900 dark:text-stone-100 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.1)] dark:hover:bg-stone-800",
  ghost: "text-stone-600 hover:bg-stone-900/5 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-white/5 dark:hover:text-white",
  /** For dark surfaces regardless of the viewer's theme. */
  glass: "bg-white/[0.05] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_0_0_1px_rgb(255_255_255/0.1)] backdrop-blur hover:bg-white/[0.09]",
  inverse: "bg-white text-stone-950 shadow-[inset_0_-1px_0_rgb(0_0_0/0.08),0_8px_24px_-10px_rgb(255_255_255/0.4)] hover:bg-stone-100",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

export function buttonClass({ variant = "primary", size = "md", full = false, className = "" }: { variant?: Variant; size?: Size; full?: boolean; className?: string } = {}) {
  return `${base} ${VARIANTS[variant]} ${SIZES[size]} ${full ? "w-full" : ""} ${className}`;
}

type Common = { variant?: Variant; size?: Size; full?: boolean; className?: string; children: ReactNode };

/** The one button: consistent height, padding and focus ring everywhere. Pass `href` for a link that looks like a button. */
export function Button({ variant, size, full, className, children, href, ...rest }: Common & { href?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = buttonClass({ variant, size, full, className });
  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  );
}

export function ArrowRight({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}
