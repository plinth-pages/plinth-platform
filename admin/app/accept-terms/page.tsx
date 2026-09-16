"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BrandMark } from "@/components/ui/Brand";
import { Button } from "@/components/ui/Button";
import { ApiError, api } from "@/lib/api";

const POINTS = [
  "Your site's code and content live in a public repository, and your published site is public.",
  "Integration API keys are encrypted and never made public.",
  "Co-pilot prompts are sent to AI providers to generate changes — review what you publish.",
  "If you're under 18, a parent or guardian must agree to these terms for you.",
];

/** Shown once to anyone signed in who hasn't accepted the current Terms and Privacy Policy. */
export default function AcceptTermsPage() {
  return (
    <Suspense>
      <AcceptTerms />
    </Suspense>
  );
}

function AcceptTerms() {
  const router = useRouter();
  const params = useSearchParams();
  const [version, setVersion] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(
      ({ user }) => user.termsAccepted && router.replace(safeNext(params.get("next"))),
      (e) => e instanceof ApiError && e.status === 401 && router.replace("/login?mode=signin"),
    );
    api.authMethods().then((methods) => setVersion(methods.termsVersion), () => setError("Couldn't load the current terms. Refresh to try again."));
  }, [params, router]);

  async function accept() {
    if (!version) return;
    setBusy(true);
    setError(null);
    try {
      await api.acceptTerms(version);
      router.replace(safeNext(params.get("next")));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-white px-6 py-16 dark:bg-stone-950">
      <div aria-hidden className="absolute top-1/3 left-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(76_98_220/0.12),transparent)]" />
      <div className="relative mb-8 flex items-center gap-2">
        <BrandMark className="h-5 w-5" />
        <span className="text-[15px] font-semibold tracking-tight">Plinth</span>
      </div>
      <div className="relative w-full max-w-[480px] rounded-2xl bg-white p-7 shadow-[0_0_0_1px_rgb(28_25_23/0.08),0_24px_48px_-24px_rgb(28_25_23/0.25)] dark:bg-stone-900 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08)]">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Review our terms</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-stone-500 dark:text-stone-400">
          Before you continue, please read and accept our <Link href="/terms" target="_blank" className="font-medium text-stone-900 underline underline-offset-2 dark:text-white">Terms of Service</Link>{" "}
          and <Link href="/privacy" target="_blank" className="font-medium text-stone-900 underline underline-offset-2 dark:text-white">Privacy Policy</Link>. The key points:
        </p>
        <ul className="mt-4 flex flex-col gap-2.5 text-sm text-stone-700 dark:text-stone-300">
          {POINTS.map((point) => (
            <li key={point} className="flex gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
              {point}
            </li>
          ))}
        </ul>
        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl bg-stone-50 p-3.5 text-sm ring-1 ring-stone-200 dark:bg-stone-950 dark:ring-stone-800">
          <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
          <span>I&apos;m 18 or older (or my parent or guardian agrees on my behalf), and I agree to the Terms of Service and Privacy Policy.</span>
        </label>
        {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p> : null}
        <Button type="button" variant="brand" size="lg" full className="mt-5" disabled={!agreed || !version || busy} onClick={() => void accept()}>
          {busy ? "Saving…" : "Accept and continue"}
        </Button>
        <button
          type="button"
          onClick={() => void api.logout().finally(() => router.replace("/"))}
          className="mt-3 w-full text-center text-sm text-stone-500 hover:text-stone-900 dark:hover:text-white"
        >
          Not now — sign out
        </button>
      </div>
    </main>
  );
}

/** Only same-site paths, so the query string can't send someone elsewhere. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/accept-terms") ? next : "/start";
}
