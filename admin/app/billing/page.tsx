"use client";

import type { BillingStatusResponse, SessionUser } from "@plinth-pages/shared";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
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
    load().catch((e) => e instanceof ApiError && e.status === 401 && router.replace("/"));
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    if (!checkout) return;
    window.history.replaceState(null, "", "/billing");
    if (checkout === "cancelled") {
      toast("Checkout cancelled. You haven't been charged.", "info");
      return;
    }
    // The plan changes when Stripe's webhook arrives, usually within seconds of returning here.
    setConfirming(true);
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const status = await load().catch(() => null);
      if (status?.plan === "pro") {
        clearInterval(timer);
        setConfirming(false);
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
      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Plan &amp; billing</h1>
          <p className="mt-1.5 text-stone-600 dark:text-stone-400">
            {confirming ? "Confirming your payment…" : pro ? "You're on Pro. Thanks for supporting Plinth." : "You're on the Free plan."}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <PlanCard
            name="Free"
            price="$0"
            current={!pro}
            features={[
              `${billing.limits.free.dailyMessages} co-pilot messages a day`,
              `${compact(billing.limits.free.monthlyTokens)} AI tokens a month`,
              "Fast model (GPT-OSS 120B)",
              "Integrations, preview and publishing",
            ]}
          />
          <PlanCard
            name="Pro"
            price={`$${billing.priceUsd}`}
            highlight
            current={pro}
            features={[
              `${billing.limits.pro.dailyMessages} co-pilot messages a day`,
              `${compact(billing.limits.pro.monthlyTokens)} AI tokens a month`,
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
                <button onClick={() => void go(api.billingPortal)} disabled={busy} className="h-11 rounded-lg border border-stone-300 bg-white text-sm font-medium hover:bg-stone-50 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900">
                  Manage subscription
                </button>
              </div>
            ) : (
              <button
                onClick={() => void go(api.checkout)}
                disabled={busy || confirming || !billing.checkoutAvailable}
                title={billing.checkoutAvailable ? undefined : "Billing isn't set up on this server yet"}
                className="h-11 rounded-lg bg-brand-600 text-sm font-semibold text-white shadow-card hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
              >
                {busy ? "Opening checkout…" : confirming ? "Confirming…" : `Upgrade to Pro — $${billing.priceUsd}/month`}
              </button>
            )}
          </PlanCard>
        </div>
        <p className="text-xs text-stone-500">Payments are handled securely by Stripe. Cancel any time; Pro stays active until the end of the period you&apos;ve paid for.</p>
      </main>
    </div>
  );
}

function PlanCard({ name, price, features, current, highlight, children }: { name: string; price: string; features: string[]; current: boolean; highlight?: boolean; children?: React.ReactNode }) {
  return (
    <section className={`flex flex-col gap-5 rounded-2xl bg-white p-6 shadow-card ring-1 dark:bg-stone-900 ${highlight ? "ring-2 ring-brand-500" : "ring-stone-200/80 dark:ring-stone-800"}`}>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{name}</h2>
          <p className="mt-1">
            <span className="text-3xl font-semibold tracking-tight">{price}</span>
            <span className="text-sm text-stone-500"> / month</span>
          </p>
        </div>
        {current ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Current plan</span> : null}
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" fill="currentColor" aria-hidden>
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
            </svg>
            {feature}
          </li>
        ))}
      </ul>
      {children ? <div className="mt-auto">{children}</div> : null}
    </section>
  );
}
