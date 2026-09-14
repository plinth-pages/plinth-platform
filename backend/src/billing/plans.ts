import type { Plan } from "@prisma/client";

export interface PlanLimits {
  /** Co-pilot messages per rolling 24 hours. */
  dailyMessages: number;
  /** Model tokens (input + output) per rolling 30 days. */
  monthlyTokens: number;
  /** Premium models (Claude, GPT-4o). */
  premiumModels: boolean;
}

/** What each plan includes. The single place limits are defined; the API, the chat and the admin console read it. */
export const PLANS: Record<Plan, { name: string; priceUsd: number; limits: PlanLimits }> = {
  free: { name: "Free", priceUsd: 0, limits: { dailyMessages: 20, monthlyTokens: 300_000, premiumModels: false } },
  pro: { name: "Pro", priceUsd: 15, limits: { dailyMessages: 300, monthlyTokens: 5_000_000, premiumModels: true } },
};

/** Stripe subscription statuses that keep Pro. `past_due` keeps it while Stripe retries the payment. */
export const PRO_STATUSES = new Set(["active", "trialing", "past_due"]);
