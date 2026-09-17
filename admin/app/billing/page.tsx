"use client";

import Link from "next/link";
import type { BillingStatusResponse, SessionUser } from "@plinth-pages/shared";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Button, ArrowRight } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ApiError, api } from "@/lib/api";

export default function BillingPage() {
  return (
    <Suspense fallback={<main className="min-h-screen" aria-busy="true" />}>
      <Billing />
    </Suspense>
  );
}

const compact = (n: number) => Intl.NumberFormat("en", { notation: "compact" }).format(n);

function Billing() {
  const router = useRouter();
  const toast = useToast();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [billing, setBilling] = useState<BillingStatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const [me, status] = await Promise.all([api.me(), api.billingStatus()]);
    setUser(me.user);
    setBilling(status);
    return status;
  }, []);

  useEffect(() => {
    load().catch((e) => e instanceof ApiError && e.status === 401 && router.replace("/login"));
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const sessionId = params.get("session_id");
    if (!checkout) return;
    window.history.replaceState(null, "", "/billing");
    if (checkout === "cancelled") {
      toast("Checkout cancelled. You haven't been charged.", "info");
      return;
    }
    // Confirm with Stripe straight away; the webhook (if configured) may also arrive — both apply the same state.
    setConfirming(true);
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const status = sessionId ? await api.confirmCheckout(sessionId).then((result) => (setBilling(result), result)).catch(() => null) : await load().catch(() => null);
      if (status?.plan === "pro") {
        clearInterval(timer);
        setConfirming(false);
        void load();
        toast("Welcome to Pro! Premium models and higher limits are unlocked.", "success");
      } else if (tries >= 30) {
        clearInterval(timer);
        setConfirming(false);
        toast("Payment received — your plan will update in a moment. Refresh if it doesn't.", "info");
      }
    }, 2_000);
    return () => clearInterval(timer);
  }, [load, router, toast]);

  async function go(action: () => Promise<{ url: string }>) {
    setBusy(true);
    try {
      window.location.href = (await action()).url;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Billing is unavailable right now.", "error");
      setBusy(false);
    }
  }

  if (!user || !billing) return <main className="min-h-screen" aria-busy="true" />;
  const pro = billing.plan === "pro";

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-14">
        <div className="text-center">
          <p className="text-[13px] font-medium tracking-wide text-brand-600 dark:text-brand-300">Plan &amp; billing</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.035em] text-balance">{pro ? "You're on Pro" : "Unlock the full co-pilot"}</h1>
          <p className="mx-auto mt-3 max-w-md text-[15px] text-stone-500 dark:text-stone-400">
            {confirming ? "Confirming your payment…" : pro ? "You're on Pro. Thanks for supporting Plinth." : "You're on the Free plan."}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <PlanCard
            name="Free"
            price="$0"
            current={!pro}
            features={[
              `${compact(billing.limits.free.dailyTokens)} AI tokens a day, ${compact(billing.limits.free.monthlyTokens)} a month`,
              `Requests up to ${billing.limits.free.maxRequestChars.toLocaleString("en")} characters`,
              "Fast model (GPT-OSS 120B)",
              "Integrations, preview and publishing",
            ]}
          >
            <Button disabled variant="secondary" size="lg" full className="!opacity-100 text-stone-500 shadow-[0_0_0_1px_rgb(28_25_23/0.08)] dark:text-stone-400">
              {pro ? "Included with Pro" : "Your current plan"}
            </Button>
          </PlanCard>
          <PlanCard
            name="Pro"
            price={`$${billing.priceUsd}`}
            highlight
            current={pro}
            features={[
              `${compact(billing.limits.pro.dailyTokens)} AI tokens a day, ${compact(billing.limits.pro.monthlyTokens)} a month`,
              `Requests up to ${billing.limits.pro.maxRequestChars.toLocaleString("en")} characters`,
              "Premium models: Claude and GPT-4o",
              "Everything in Free",
            ]}
          >
            {pro ? (
              <div className="flex flex-col gap-2">
                {billing.renewsAt ? (
                  <p className="text-sm text-stone-600 dark:text-stone-400">
                    {billing.cancelsAtPeriodEnd ? "Ends" : "Renews"} on {new Date(billing.renewsAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
                    {billing.status === "past_due" ? " · payment is being retried" : ""}
                  </p>
                ) : null}
                <Button onClick={() => void go(api.billingPortal)} disabled={busy} variant="secondary" size="lg" full>
                  Manage subscription
                </Button>
              </div>
            ) : (
              <Button
                onClick={() => void go(api.checkout)}
                disabled={busy || confirming || !billing.checkoutAvailable}
                title={billing.checkoutAvailable ? undefined : "Billing isn't set up on this server yet"}
                variant="brand"
                size="lg"
                full
              >
                {busy ? "Opening checkout…" : confirming ? "Confirming…" : "Upgrade to Pro"}
                {!busy && !confirming ? <ArrowRight /> : null}
              </Button>
            )}
          </PlanCard>
        </div>
        <p className="text-center text-[13px] text-stone-500">
          Subscriptions renew monthly until cancelled and are covered by our{" "}
          <Link href="/terms#plans" className="underline underline-offset-2">Terms</Link>.{" "}
        </p>
        <p className="text-center text-[13px] text-stone-500">Payments are handled securely by Stripe. Cancel any time; Pro stays active until the end of the period you&apos;ve paid for.</p>
      </main>
    </div>
  );
}

function PlanCard({ name, price, features, current, highlight, children }: { name: string; price: string; features: string[]; current: boolean; highlight?: boolean; children?: React.ReactNode }) {
  return (
    <section
      className={`relative flex flex-col gap-6 rounded-2xl p-7 ${
        highlight
          ? "bg-gradient-to-b from-brand-50 to-white shadow-[0_0_0_1px_rgb(76_98_220/0.45),0_24px_48px_-24px_rgb(76_98_220/0.45)] dark:from-brand-950/60 dark:to-stone-900"
          : "bg-white shadow-[0_0_0_1px_rgb(28_25_23/0.08),0_1px_2px_rgb(28_25_23/0.04)] dark:bg-stone-900 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08)]"
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{name}</h2>
          <p className="mt-3">
            <span className="text-5xl font-semibold tracking-[-0.04em]">{price}</span>
            <span className="text-sm text-stone-500"> / month</span>
          </p>
        </div>
        {current ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/15 dark:bg-emerald-950 dark:text-emerald-300">Current plan</span>
        ) : highlight ? (
          <span className="rounded-full bg-brand-600 px-2.5 py-1 text-xs font-medium text-white">Recommended</span>
        ) : null}
      </div>
      <ul className="flex flex-col gap-3 text-[15px] text-stone-700 dark:text-stone-300">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <svg viewBox="0 0 16 16" className="mt-1 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" fill="currentColor" aria-hidden>
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
            </svg>
            {feature}
          </li>
        ))}
      </ul>
      {children ? <div className="mt-auto pt-2">{children}</div> : null}
    </section>
  );
}
