import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { BillingPass } from "@plinth-pages/shared";
import { z } from "zod";
import type { Env } from "../config/env";

const logger = new Logger("Passes");

/** A day in milliseconds, and the month length a pass is measured in. */
export const DAY_MS = 24 * 60 * 60_000;
const MONTH_DAYS = 30;

const passSchema = z.object({
  id: z.string().trim().min(1).max(24),
  label: z.string().trim().min(1).max(40),
  days: z.coerce.number().int().min(1).max(3_650),
  /** In the currency's smallest unit — paise for INR, cents for USD. */
  amount: z.coerce.number().int().min(100),
});

/** Razorpay is the way Pro is paid for, so "configured" means "anyone can buy Pro on this server". */
export function paymentsConfigured(config: ConfigService<Env, true>): boolean {
  return Boolean(config.get("RAZORPAY_KEY_ID", { infer: true }) && config.get("RAZORPAY_KEY_SECRET", { infer: true }));
}

/**
 * What Pro can be bought as. Each pass is a single payment for a number of days — nothing is auto-debited, so there is
 * no subscription to cancel and no card kept on file. The two defaults (a month and a year) can be replaced wholesale
 * with `RAZORPAY_PASSES`, which is how a different currency or a different set of lengths is rolled out without a deploy.
 */
export function proPasses(config: ConfigService<Env, true>): BillingPass[] {
  const currency = config.get("RAZORPAY_CURRENCY", { infer: true });
  const passes = configuredPasses(config) ?? [
    { id: "monthly", label: "1 month", days: MONTH_DAYS, amount: config.get("RAZORPAY_PRO_PRICE_PAISE", { infer: true }) },
    { id: "yearly", label: "12 months", days: 365, amount: config.get("RAZORPAY_PRO_YEAR_PRICE_PAISE", { infer: true }) },
  ];

  // The shortest pass is the list price everything else is measured against; the cheapest per day is the one to point at.
  const baseline = passes.reduce((shortest, pass) => (pass.days < shortest.days ? pass : shortest), passes[0]);
  const rate = baseline.amount / baseline.days;
  const best = passes.reduce((cheapest, pass) => (pass.amount / pass.days < cheapest.amount / cheapest.days ? pass : cheapest), passes[0]);
  return passes.map((pass) => {
    const saved = Math.round((1 - pass.amount / (rate * pass.days)) * 100);
    return { ...pass, currency, months: Math.max(1, Math.round(pass.days / MONTH_DAYS)), savingsPercent: saved >= 5 ? saved : null, recommended: passes.length > 1 && pass.id === best.id };
  });
}

/** One pass by id; the first pass when nothing is asked for, and null when the id isn't one of ours. */
export function passById(config: ConfigService<Env, true>, rawId: unknown): BillingPass | null {
  const passes = proPasses(config);
  if (rawId === undefined || rawId === null || rawId === "") return passes[0] ?? null;
  return passes.find((pass) => pass.id === String(rawId)) ?? null;
}

function configuredPasses(config: ConfigService<Env, true>): z.infer<typeof passSchema>[] | null {
  const raw = config.get("RAZORPAY_PASSES", { infer: true });
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    logger.warn("RAZORPAY_PASSES isn't valid JSON; using the built-in passes.");
    return null;
  }
  const parsed = z.array(passSchema).min(1).safeParse(json);
  if (!parsed.success) {
    logger.warn(`RAZORPAY_PASSES is not a valid list of passes; using the built-in ones. ${parsed.error.issues[0]?.message ?? ""}`);
    return null;
  }
  const ids = new Set(parsed.data.map((pass) => pass.id));
  if (ids.size !== parsed.data.length) {
    logger.warn("RAZORPAY_PASSES has duplicate ids; using the built-in ones.");
    return null;
  }
  return parsed.data;
}
