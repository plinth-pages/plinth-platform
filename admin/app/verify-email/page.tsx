import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/ui/Brand";
import { ConfirmEmail } from "./ConfirmEmail";

export const metadata: Metadata = { title: "Confirm your email · Plinth" };

/** Where the "Confirm sign up" email lands: `/verify-email?token_hash=…&type=email`. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
  const { token_hash, type } = await searchParams;

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-white px-6 py-16 dark:bg-stone-950">
      <div aria-hidden className="absolute top-1/3 left-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(76_98_220/0.14),transparent)]" />
      <Link href="/" className="relative mb-10 flex items-center gap-2">
        <BrandMark className="h-5 w-5" />
        <span className="text-[15px] font-semibold tracking-tight">Plinth</span>
      </Link>
      <div className="relative w-full max-w-[400px] rounded-2xl bg-white p-7 shadow-[0_0_0_1px_rgb(28_25_23/0.08),0_24px_48px_-24px_rgb(28_25_23/0.25)] dark:bg-stone-900 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08)]">
        <ConfirmEmail tokenHash={token_hash ?? null} type={type === "signup" ? "signup" : "email"} />
      </div>
    </main>
  );
}
