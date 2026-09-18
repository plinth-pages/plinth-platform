"use client";

import type { BillingPass, SessionUser } from "@plinth-pages/shared";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";

const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

/** The slice of Razorpay's Standard Checkout this uses. */
interface RazorpayCheckout {
  open(): void;
  on(event: "payment.failed", handler: (response: { error?: { description?: string } }) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

/** Loaded only when someone goes to pay, so the script never slows the page down for everyone else. */
function loadCheckout(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SCRIPT}"]`);
    const script = existing ?? Object.assign(document.createElement("script"), { src: CHECKOUT_SCRIPT, async: true });
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Couldn't load the payment window.")), { once: true });
    if (!existing) document.body.appendChild(script);
  });
}

/** Amounts arrive in the currency's smallest unit — paise for INR, cents for USD. */
export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100);
}

/** The same amount per month, for comparing a longer pass with a shorter one. */
export const perMonth = (pass: BillingPass) => money(Math.round(pass.amount / pass.months), pass.currency);

/**
 * Buying Pro: one payment for a pass of a given length. The order is created by our API, Razorpay's modal collects the
 * payment, and the signature it returns is verified by our API before anything changes — nothing here can grant Pro on
 * its own. Nothing is auto-debited either, so no card is kept on file and there is nothing to cancel later.
 */
export function PassCheckout({
  user,
  passes,
  value,
  onChange,
  promoCode,
  onPaid,
  action,
}: {
  user: SessionUser;
  passes: BillingPass[];
  value: string;
  onChange: (passId: string) => void;
  promoCode?: string;
  onPaid: () => void;
  action: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pass = passes.find((option) => option.id === value) ?? passes[0];

  async function pay() {
    setBusy(true);
    try {
      const [order] = await Promise.all([api.razorpayOrder(pass.id, promoCode), loadCheckout()]);
      if (!window.Razorpay) throw new Error("Couldn't load the payment window.");

      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "Plinth",
        description: `Pro — ${order.passLabel}`,
        prefill: { name: user.name ?? undefined, email: undefined },
        theme: { color: "#4c62dc" },
        modal: {
          ondismiss: () => {
            setBusy(false);
            toast("Payment cancelled. You haven't been charged.", "info");
          },
        },
        handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          void (async () => {
            try {
              const result = await api.verifyRazorpay(response);
              toast(result.alreadyApplied ? "That payment was already applied." : `Payment received — Pro is yours until ${new Date(result.renewsAt!).toLocaleDateString()}.`, "success");
              onPaid();
            } catch (error) {
              // The money is with Razorpay; support can settle it from the payment id.
              toast(error instanceof Error ? error.message : "We couldn't confirm that payment. Please contact us.", "error");
            } finally {
              setBusy(false);
            }
          })();
        },
      });
      checkout.on("payment.failed", (failure) => {
        setBusy(false);
        toast(failure.error?.description ?? "The payment didn't go through. Please try again.", "error");
      });
      checkout.open();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Payments are unavailable right now.", "error");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {passes.length > 1 ? (
        <div className="flex gap-2" role="radiogroup" aria-label="How long">
          {passes.map((option) => {
            const chosen = option.id === pass.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                onClick={() => onChange(option.id)}
                className={`min-w-0 flex-1 rounded-xl px-3 py-2.5 text-left transition ${
                  chosen
                    ? "bg-white shadow-[0_0_0_1.5px_rgb(76_98_220)] dark:bg-stone-900"
                    : "bg-white/60 shadow-[0_0_0_1px_rgb(28_25_23/0.1)] hover:shadow-[0_0_0_1px_rgb(28_25_23/0.25)] dark:bg-stone-900/50 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.12)]"
                }`}
              >
                <span className="block truncate text-sm font-medium">{option.label}</span>
                <span className="block truncate text-xs text-stone-500 dark:text-stone-400">
                  {option.savingsPercent ? `${perMonth(option)} a month · save ${option.savingsPercent}%` : `${money(option.amount, option.currency)} once`}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <Button type="button" variant="brand" size="lg" full disabled={busy} onClick={() => void pay()}>
        {busy ? "Opening payment…" : `${action} — ${money(pass.amount, pass.currency)}`}
      </Button>
      <p className="text-center text-xs text-stone-500">
        {pass.label} of Pro, paid once. Nothing auto-renews · UPI, cards and netbanking.
      </p>
    </div>
  );
}
