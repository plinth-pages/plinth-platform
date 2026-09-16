"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { ApiError, api } from "@/lib/api";

/**
 * Confirming takes a click on purpose: some mail providers open every link in an email to scan it, which would use up
 * a link that confirmed on page load before the person ever saw it.
 */
export function ConfirmEmail({ tokenHash, type }: { tokenHash: string | null; type: "email" | "signup" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(tokenHash ? null : "This link is incomplete. Open it again from the email, or request a new one.");

  async function confirm() {
    if (!tokenHash) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.confirmEmail({ token_hash: tokenHash, type });
      router.replace(result.next);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "We couldn't confirm your email. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Confirm your email</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-stone-500 dark:text-stone-400">One click and you&apos;re in — we&apos;ll take you straight to your site.</p>
      </div>
      {error ? (
        <div role="alert" className="flex flex-col gap-3">
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>
          <Link href="/login?mode=signin" className={buttonClass({ variant: "secondary", size: "lg", full: true })}>
            Go to sign in
          </Link>
        </div>
      ) : (
        <Button type="button" variant="brand" size="lg" full disabled={busy} onClick={() => void confirm()}>
          {busy ? "Confirming…" : "Confirm and continue"}
        </Button>
      )}
    </div>
  );
}
