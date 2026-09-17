import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import type { PromoCode, User } from "@prisma/client";
import type { AdminPromoCode, PromoCodePreview } from "@plinth-pages/shared";
import { randomBytes } from "crypto";
import Stripe from "stripe";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { STRIPE } from "./billing.service";

export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;

export const createPromoSchema = z
  .object({
    /** Leave empty to generate one. */
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(CODE_PATTERN, "Use 3–30 letters, numbers, dashes or underscores.")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    percentOff: z.coerce.number().int().min(1, "At least 1%.").max(100, "At most 100%."),
    duration: z.enum(["once", "repeating", "forever"]),
    durationMonths: z.coerce.number().int().min(1).max(36).optional(),
    /** How long the code can be redeemed for, in hours. Empty means no expiry. */
    validForHours: z.coerce.number().int().min(1).max(24 * 365).optional(),
    maxRedemptions: z.coerce.number().int().min(1).max(100_000).optional(),
    note: z.string().trim().max(120).optional(),
  })
  .refine((value) => value.duration !== "repeating" || value.durationMonths, { message: "Choose how many months the discount lasts.", path: ["durationMonths"] });

/**
 * Marketing and referral discounts. Each code is a Stripe coupon plus a customer-facing promotion code, so Stripe
 * enforces the percentage, expiry and redemption limit at checkout; Plinth keeps a record for the admin console and
 * lets people apply a code on its own billing page (or through a shared link) before they reach Stripe.
 */
@Injectable()
export class PromoCodes {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(STRIPE) private readonly stripe: Stripe | null = null,
  ) {}

  async create(admin: User, body: unknown): Promise<AdminPromoCode> {
    const stripe = this.requireStripe();
    const parsed = createPromoSchema.safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
      throw new BadRequestException({ statusCode: 400, message: Object.values(fields)[0], fields });
    }
    const input = parsed.data;
    const code = input.code ?? generateCode(input.percentOff);
    if (await this.prisma.promoCode.findUnique({ where: { code } })) {
      throw new ConflictException({ statusCode: 409, message: "That code already exists.", fields: { code: "That code already exists." } });
    }
    const expiresAt = input.validForHours ? new Date(Date.now() + input.validForHours * 60 * 60_000) : null;

    const coupon = await stripe.coupons.create({
      percent_off: input.percentOff,
      duration: input.duration,
      ...(input.duration === "repeating" ? { duration_in_months: input.durationMonths } : {}),
      name: `${code} · ${input.percentOff}% off`,
      metadata: { plinthCode: code, createdBy: admin.id },
    });
    let promotion: Stripe.PromotionCode;
    try {
      promotion = await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: coupon.id },
        code,
        ...(expiresAt ? { expires_at: Math.floor(expiresAt.getTime() / 1000) } : {}),
        ...(input.maxRedemptions ? { max_redemptions: input.maxRedemptions } : {}),
        metadata: { plinthCode: code },
      });
    } catch (error) {
      // Don't leave an orphaned coupon behind if the code itself was refused (for example, taken in Stripe).
      await stripe.coupons.del(coupon.id).catch(() => undefined);
      throw new BadRequestException(error instanceof Error ? `Stripe refused the code: ${error.message}` : "Stripe refused the code.");
    }

    const row = await this.prisma.promoCode.create({
      data: {
        code,
        percentOff: input.percentOff,
        duration: input.duration,
        durationMonths: input.duration === "repeating" ? (input.durationMonths ?? null) : null,
        expiresAt,
        maxRedemptions: input.maxRedemptions ?? null,
        note: input.note || null,
        stripeCouponId: coupon.id,
        stripePromotionCodeId: promotion.id,
        createdById: admin.id,
      },
    });
    return toAdmin(row, 0);
  }

  /** Every code, newest first, with how many times Stripe has seen it redeemed. */
  async list(): Promise<AdminPromoCode[]> {
    const rows = await this.prisma.promoCode.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    const redeemed = new Map<string, number>();
    if (this.stripe && rows.length) {
      for await (const promotion of this.stripe.promotionCodes.list({ limit: 100 })) {
        redeemed.set(promotion.id, promotion.times_redeemed);
        if (redeemed.size >= 1_000) break;
      }
    }
    return rows.map((row) => toAdmin(row, redeemed.get(row.stripePromotionCodeId) ?? 0));
  }

  async deactivate(id: string): Promise<void> {
    const stripe = this.requireStripe();
    const row = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Promo code not found.");
    await stripe.promotionCodes.update(row.stripePromotionCodeId, { active: false });
    await this.prisma.promoCode.update({ where: { id }, data: { active: false } });
  }

  /** What a code gives, for the billing page — or a clear reason it can't be used. */
  async preview(rawCode: unknown): Promise<PromoCodePreview> {
    const promotion = await this.findActive(rawCode);
    const coupon = await this.couponOf(promotion);
    return {
      code: promotion.code,
      percentOff: coupon.percent_off ?? 0,
      duration: (["once", "repeating", "forever"] as const).find((d) => d === coupon.duration) ?? "once",
      durationMonths: coupon.duration_in_months ?? null,
      expiresAt: promotion.expires_at ? new Date(promotion.expires_at * 1000).toISOString() : null,
    };
  }

  /** The Stripe promotion code id to attach to a checkout. */
  async promotionIdFor(rawCode: unknown): Promise<string> {
    return (await this.findActive(rawCode)).id;
  }

  private async findActive(rawCode: unknown): Promise<Stripe.PromotionCode> {
    const stripe = this.requireStripe();
    const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
    if (!CODE_PATTERN.test(code)) throw new BadRequestException({ statusCode: 400, code: "PROMO_INVALID", message: "That promo code isn't valid." });
    const { data } = await stripe.promotionCodes.list({ code, limit: 1 });
    const promotion = data[0];
    if (!promotion) throw new BadRequestException({ statusCode: 400, code: "PROMO_INVALID", message: "That promo code isn't valid." });
    const expired = promotion.expires_at !== null && promotion.expires_at * 1000 <= Date.now();
    const usedUp = promotion.max_redemptions !== null && promotion.times_redeemed >= promotion.max_redemptions;
    if (!promotion.active || expired || usedUp) {
      throw new BadRequestException({ statusCode: 400, code: "PROMO_EXPIRED", message: usedUp ? "That promo code has been fully used." : expired ? "That promo code has expired." : "That promo code is no longer active." });
    }
    return promotion;
  }

  private async couponOf(promotion: Stripe.PromotionCode): Promise<Stripe.Coupon> {
    const coupon = promotion.promotion.coupon;
    if (coupon && typeof coupon !== "string") return coupon;
    if (!coupon) throw new BadRequestException({ statusCode: 400, code: "PROMO_INVALID", message: "That promo code isn't valid." });
    return this.requireStripe().coupons.retrieve(coupon);
  }

  private requireStripe(): Stripe {
    if (!this.stripe) throw new ServiceUnavailableException("Billing isn't set up on this server yet.");
    return this.stripe;
  }
}

function generateCode(percentOff: number): string {
  // Unambiguous characters only, so codes read well out loud and in a tweet.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  const suffix = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `PLINTH${percentOff}-${suffix}`;
}

function toAdmin(row: PromoCode, timesRedeemed: number): AdminPromoCode {
  const expired = row.expiresAt !== null && row.expiresAt.getTime() <= Date.now();
  const usedUp = row.maxRedemptions !== null && timesRedeemed >= row.maxRedemptions;
  return {
    id: row.id,
    code: row.code,
    percentOff: row.percentOff,
    duration: row.duration,
    durationMonths: row.durationMonths,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    maxRedemptions: row.maxRedemptions,
    timesRedeemed,
    note: row.note,
    status: !row.active ? "inactive" : expired ? "expired" : usedUp ? "used_up" : "active",
    createdAt: row.createdAt.toISOString(),
  };
}
