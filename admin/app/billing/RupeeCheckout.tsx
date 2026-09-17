"use client";

import type { BillingStatusResponse, SessionUser } from "@plinth-pages/shared";
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

/** Loaded only when someone chooses to pay in rupees, so the script never slows the page down for everyone else. */
function loadCheckout(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SCRIPT}"]`);
    const script = existing ?? Object.assign(document.createElement("script"), { src: CHECKOUT_SCRIPT, async: true });
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Couldn't load Razorpay.")), { once: true });
    if (!existing) document.body.appendChild(script);
  });
}

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;

/**
 * Pay for 30 days of Pro in rupees. The order is created by our API, Razorpay's modal collects the payment, and the
 * signature it returns is verified by our API before anything changes — nothing here can grant Pro on its own.
 */
export function RupeeCheckout({ user, billing, promoCode, onPaid }: { user: SessionUser; billing: BillingStatusResponse; promoCode?: string; onPaid: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function pay() {
    setBusy(true);
    try {
      const [order] = await Promise.all([api.razorpayOrder(promoCode), loadCheckout()]);
      if (!window.Razorpay) throw new Error("Couldn't load Razorpay.");

      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "Plinth",
        description: `Pro — ${order.days} days`,
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
    <div className="flex flex-col gap-1.5">
      <Button type="button" variant="secondary" size="lg" full disabled={busy} onClick={() => void pay()}>
        {busy ? "Opening payment…" : `Pay ${rupees(billing.rupeesPricePaise)} in India — UPI, cards`}
      </Button>
      <p className="text-center text-xs text-stone-500">30 days of Pro, paid once. Nothing auto-renews.</p>
    </div>
  );
}
