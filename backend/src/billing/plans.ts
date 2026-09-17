import type { Plan } from "@prisma/client";

/**
 * Plinth AI is limited by how much work requests take, not by how many there are: a one-line tweak and a full-page
 * rewrite cost very different amounts. Three things are checked before a request runs:
 * - the request itself fits the plan (`maxRequestChars`);
 * - the tokens used in the last 24 hours are under `dailyTokens`, so one heavy session can't burn the month;
 * - the tokens used in the last 30 days are under `monthlyTokens`.
 * A request that still doesn't fit the model's context window is stopped with a "too big" reply by the worker.
 */
export interface PlanLimits {
  /** Longest single request, in characters. */
  maxRequestChars: number;
  /** Model tokens (input + output) per rolling 24 hours. */
  dailyTokens: number;
  /** Model tokens (input + output) per rolling 30 days. */
  monthlyTokens: number;
  /** Premium models (Claude, GPT-4o). */
  premiumModels: boolean;
}

/** What each plan includes. The single place limits are defined; the API, the chat and the admin console read it. */
export const PLANS: Record<Plan, { name: string; priceUsd: number; limits: PlanLimits }> = {
  free: { name: "Free", priceUsd: 0, limits: { maxRequestChars: 1_500, dailyTokens: 60_000, monthlyTokens: 300_000, premiumModels: false } },
  pro: { name: "Pro", priceUsd: 15, limits: { maxRequestChars: 8_000, dailyTokens: 1_000_000, monthlyTokens: 5_000_000, premiumModels: true } },
};

/** The largest request any plan accepts; the API refuses anything longer before looking at the plan. */
export const MAX_REQUEST_CHARS = Math.max(...Object.values(PLANS).map((plan) => plan.limits.maxRequestChars));

/** Stripe subscription statuses that keep Pro. `past_due` keeps it while Stripe retries the payment. */
export const PRO_STATUSES = new Set(["active", "trialing", "past_due"]);
