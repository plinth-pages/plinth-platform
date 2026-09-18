import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
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
 * Marketing and referral discounts. Codes live in Plinth's own table, which is what enforces the percentage, expiry
 * and redemption limit — a pass is simply charged for less. When Stripe is configured the code is mirrored there too,
 * so the legacy subscription checkout still honours it; without Stripe, codes work exactly the same.
 */
@Injectable()
export class PromoCodes {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(STRIPE) private readonly stripe: Stripe | null = null,
  ) {}

  async create(admin: User, body: unknown): Promise<AdminPromoCode> {
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

    const mirror = await this.mirrorToStripe(admin, { ...input, code, expiresAt });

    const row = await this.prisma.promoCode.create({
      data: {
        code,
        percentOff: input.percentOff,
        duration: input.duration,
        durationMonths: input.duration === "repeating" ? (input.durationMonths ?? null) : null,
        expiresAt,
        maxRedemptions: input.maxRedemptions ?? null,
        note: input.note || null,
        stripeCouponId: mirror?.couponId ?? null,
        stripePromotionCodeId: mirror?.promotionId ?? null,
        createdById: admin.id,
      },
    });
    return toAdmin(row, 0);
  }

  /** Every code, newest first, with how many times it has actually been used. */
  async list(): Promise<AdminPromoCode[]> {
    const rows = await this.prisma.promoCode.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    const redeemed = await this.redemptions(rows);
    return rows.map((row) => toAdmin(row, redeemed.get(row.code) ?? 0));
  }

  async deactivate(id: string): Promise<void> {
    const row = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Promo code not found.");
    if (this.stripe && row.stripePromotionCodeId) {
      await this.stripe.promotionCodes.update(row.stripePromotionCodeId, { active: false }).catch(() => undefined);
    }
    await this.prisma.promoCode.update({ where: { id }, data: { active: false } });
  }

  /** What a code gives, for the billing page — or a clear reason it can't be used. */
  async preview(rawCode: unknown): Promise<PromoCodePreview> {
    const row = await this.findUsable(rawCode);
    return {
      code: row.code,
      percentOff: row.percentOff,
      duration: row.duration,
      durationMonths: row.durationMonths,
      expiresAt: row.expiresAt?.toISOString() ?? null,
    };
  }

  /** The Stripe promotion code id to attach to a legacy subscription checkout. */
  async promotionIdFor(rawCode: unknown): Promise<string> {
    const row = await this.findUsable(rawCode);
    if (!row.stripePromotionCodeId) {
      throw new BadRequestException({ statusCode: 400, code: "PROMO_INVALID", message: "That promo code can't be used with a card subscription." });
    }
    return row.stripePromotionCodeId;
  }

  /** The code someone typed, if it's real, live and not used up. A pass takes the percentage straight off the amount. */
  async findUsable(rawCode: unknown): Promise<PromoCode> {
    const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
    const invalid = new BadRequestException({ statusCode: 400, code: "PROMO_INVALID", message: "That promo code isn't valid." });
    if (!CODE_PATTERN.test(code)) throw invalid;

    const row = await this.prisma.promoCode.findUnique({ where: { code } });
    if (!row) throw invalid;
    const unusable = (message: string) => new BadRequestException({ statusCode: 400, code: "PROMO_EXPIRED", message });
    if (!row.active) throw unusable("That promo code is no longer active.");
    if (row.expiresAt && row.expiresAt <= new Date()) throw unusable("That promo code has expired.");
    if (row.maxRedemptions !== null && ((await this.redemptions([row])).get(row.code) ?? 0) >= row.maxRedemptions) {
      throw unusable("That promo code has been fully used.");
    }
    return row;
  }

  /** How often each code has been redeemed: paid passes here, plus Stripe's own count for codes mirrored there. */
  private async redemptions(rows: PromoCode[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (!rows.length) return counts;

    const paid = await this.prisma.paymentOrder.groupBy({
      by: ["promoCode"],
      where: { status: "paid", promoCode: { in: rows.map((row) => row.code) } },
      _count: { _all: true },
    });
    for (const group of paid) if (group.promoCode) counts.set(group.promoCode, group._count._all);

    const mirrored = new Map(rows.flatMap((row) => (row.stripePromotionCodeId ? [[row.stripePromotionCodeId, row.code] as const] : [])));
    if (this.stripe && mirrored.size) {
      let seen = 0;
      for await (const promotion of this.stripe.promotionCodes.list({ limit: 100 })) {
        const code = mirrored.get(promotion.id);
        if (code) counts.set(code, (counts.get(code) ?? 0) + promotion.times_redeemed);
        if (++seen >= 1_000) break;
      }
    }
    return counts;
  }

  /** Stripe is optional: when it's there, the code works in the legacy subscription checkout too. */
  private async mirrorToStripe(
    admin: User,
    input: { code: string; percentOff: number; duration: "once" | "repeating" | "forever"; durationMonths?: number; expiresAt: Date | null; maxRedemptions?: number },
  ): Promise<{ couponId: string; promotionId: string } | null> {
    const stripe = this.stripe;
    if (!stripe) return null;

    const coupon = await stripe.coupons.create({
      percent_off: input.percentOff,
      duration: input.duration,
      ...(input.duration === "repeating" ? { duration_in_months: input.durationMonths } : {}),
      name: `${input.code} · ${input.percentOff}% off`,
      metadata: { plinthCode: input.code, createdBy: admin.id },
    });
    try {
      const promotion = await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: coupon.id },
        code: input.code,
        ...(input.expiresAt ? { expires_at: Math.floor(input.expiresAt.getTime() / 1000) } : {}),
        ...(input.maxRedemptions ? { max_redemptions: input.maxRedemptions } : {}),
        metadata: { plinthCode: input.code },
      });
      return { couponId: coupon.id, promotionId: promotion.id };
    } catch (error) {
      // Don't leave an orphaned coupon behind if the code itself was refused (for example, taken in Stripe).
      await stripe.coupons.del(coupon.id).catch(() => undefined);
      throw new BadRequestException(error instanceof Error ? `Stripe refused the code: ${error.message}` : "Stripe refused the code.");
    }
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
