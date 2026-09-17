"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/Brand";
import { Button, buttonClass } from "@/components/ui/Button";
import { ApiError, api } from "@/lib/api";

/** Where a blocked account lands: what happened, and how to reach a person about it. */
export default function SuspendedPage() {
  const router = useRouter();
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    // /me is refused for a blocked account, and the refusal carries the reason.
    api.me().then(
      () => router.replace("/start"),
      (error) => {
        if (error instanceof ApiError && error.body?.code === "account_suspended") setReason(String(error.body.message ?? ""));
        else if (error instanceof ApiError && error.status === 401) router.replace("/login?mode=signin");
      },
    );
  }, [router]);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-white px-6 py-16 dark:bg-stone-950">
      <div className="relative mb-8 flex items-center gap-2">
        <BrandMark className="h-5 w-5" />
        <span className="text-[15px] font-semibold tracking-tight">Plinth</span>
      </div>
      <div className="relative w-full max-w-[420px] rounded-2xl bg-white p-7 shadow-[0_0_0_1px_rgb(28_25_23/0.08),0_24px_48px_-24px_rgb(28_25_23/0.25)] dark:bg-stone-900 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08)]">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Your account is on hold</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-stone-500 dark:text-stone-400">
          {reason || "An administrator has paused access to this account. Your site and content are untouched."}
        </p>
        <p className="mt-4 text-sm text-stone-500 dark:text-stone-400">
          If you think this is a mistake, send us the details and we&apos;ll look into it.
        </p>
        <Link href="/privacy/request" className={buttonClass({ variant: "brand", size: "lg", full: true, className: "mt-5" })}>
          Contact us
        </Link>
        <Button type="button" variant="ghost" size="md" full className="mt-2" onClick={() => void api.logout().finally(() => router.replace("/"))}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
