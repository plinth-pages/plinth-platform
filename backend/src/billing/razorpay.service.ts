import { BadRequestException, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PromoCode, User } from "@prisma/client";
import type { RazorpayOrderResponse, RazorpayVerifyResponse } from "@plinth-pages/shared";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { CODE_PATTERN } from "./promo-codes";

/** Lets tests answer for Razorpay without the network. */
export const RAZORPAY_FETCH = Symbol("RAZORPAY_FETCH");

const API = "https://api.razorpay.com/v1";
/** Razorpay's own floor, and ours: a smaller order is a mistake somewhere. */
const MIN_PAISE = 100;
const PRO_DAYS = 30;
const TIMEOUT_MS = 15_000;

const verifyBody = z.object({
  razorpay_order_id: z.string().min(5).max(64),
  razorpay_payment_id: z.string().min(5).max(64),
  razorpay_signature: z.string().min(16).max(256),
});

/**
 * Pro paid in rupees, through Razorpay Standard Checkout: the browser opens Razorpay's modal for an order created
 * here, and Pro is granted only once the returned signature is verified with the key secret — which never leaves the
 * server. Each order buys 30 days rather than a recurring charge, so nothing is auto-debited; Stripe stays the
 * recurring option for everyone else.
 */
@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Optional() @Inject(RAZORPAY_FETCH) fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.config.get("RAZORPAY_KEY_ID", { infer: true }) && this.config.get("RAZORPAY_KEY_SECRET", { infer: true }));
  }

  /** The price in paise, after any promo code the user applied. */
  private async priceFor(code: string | undefined): Promise<{ amount: number; promo: PromoCode | null }> {
    const listPrice = this.config.get("RAZORPAY_PRO_PRICE_PAISE", { infer: true });
    if (!code) return { amount: listPrice, promo: null };

    const promo = await this.promoFor(code);
    const amount = Math.max(MIN_PAISE, Math.round((listPrice * (100 - promo.percentOff)) / 100));
    return { amount, promo };
  }

  /** Promo codes live in our own table; Razorpay has no view of them, so the discount is applied to the amount. */
  private async promoFor(rawCode: string): Promise<PromoCode> {
    const code = rawCode.trim().toUpperCase();
    const invalid = new BadRequestException({ statusCode: 400, code: "PROMO_INVALID", message: "That promo code isn't valid." });
    if (!CODE_PATTERN.test(code)) throw invalid;

    const promo = await this.prisma.promoCode.findUnique({ where: { code } });
    if (!promo) throw invalid;
    if (!promo.active || (promo.expiresAt && promo.expiresAt <= new Date())) {
      throw new BadRequestException({ statusCode: 400, code: "PROMO_EXPIRED", message: "That promo code is no longer available." });
    }
    if (promo.maxRedemptions !== null) {
      const used = await this.prisma.paymentOrder.count({ where: { promoCode: code, status: "paid" } });
      if (used >= promo.maxRedemptions) throw new BadRequestException({ statusCode: 400, code: "PROMO_EXPIRED", message: "That promo code has been fully used." });
    }
    return promo;
  }

  /** Step 1: create the order Razorpay's modal will collect payment for. */
  async createOrder(user: User, rawPromoCode?: unknown): Promise<RazorpayOrderResponse> {
    this.assertConfigured();
    if (user.plan === "pro" && user.paymentProvider === "stripe") throw new BadRequestException("You already have a Stripe subscription. Manage it from the billing page.");

    const promoCode = typeof rawPromoCode === "string" && rawPromoCode.trim() ? rawPromoCode : undefined;
    const { amount, promo } = await this.priceFor(promoCode);
    const currency = "INR";
    // Razorpay caps the receipt at 40 characters; the row id is ours to trace the payment by.
    const receipt = `plinth_${Date.now().toString(36)}_${user.id.slice(-8)}`.slice(0, 40);

    const created = await this.call("/orders", {
      amount,
      currency,
      receipt,
      notes: { userId: user.id, plan: "pro", days: String(PRO_DAYS), ...(promo ? { promoCode: promo.code } : {}) },
    });
    const orderId = String(created.id ?? "");
    if (!orderId) throw new ServiceUnavailableException("Razorpay didn't return an order.");

    await this.prisma.paymentOrder.create({
      data: { userId: user.id, providerOrderId: orderId, amount, currency, days: PRO_DAYS, promoCode: promo?.code ?? null },
    });
    this.logger.log(`Created Razorpay order ${orderId} for ${user.id} (${amount} paise${promo ? `, ${promo.code}` : ""})`);

    return {
      orderId,
      amount,
      currency,
      keyId: this.config.get("RAZORPAY_KEY_ID", { infer: true })!,
      days: PRO_DAYS,
      promo: promo ? { code: promo.code, percentOff: promo.percentOff } : null,
    };
  }

  /**
   * Step 3: the browser hands back what Razorpay gave it. Pro is granted only when the signature matches
   * HMAC-SHA256(order_id|payment_id) with the key secret, and only once per payment.
   */
  async verify(user: User, body: unknown): Promise<RazorpayVerifyResponse> {
    this.assertConfigured();
    const parsed = verifyBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ statusCode: 400, code: "PAYMENT_INCOMPLETE", message: "That payment is missing details. Please try again." });
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = parsed.data;

    const order = await this.prisma.paymentOrder.findUnique({ where: { providerOrderId: orderId } });
    if (!order || order.userId !== user.id) throw new BadRequestException({ statusCode: 400, code: "ORDER_UNKNOWN", message: "We couldn't find that payment." });

    if (!this.signatureMatches(`${orderId}|${paymentId}`, signature)) {
      await this.prisma.paymentOrder.update({ where: { id: order.id }, data: { status: "failed" } });
      this.logger.warn(`Rejected Razorpay payment ${paymentId}: signature mismatch`);
      throw new BadRequestException({ statusCode: 400, code: "SIGNATURE_MISMATCH", message: "We couldn't verify that payment. You have not been charged by Plinth." });
    }

    // Replaying the same payment must not extend the plan twice.
    if (order.status === "paid") return { plan: "pro", renewsAt: user.planRenewsAt?.toISOString() ?? null, alreadyApplied: true };

    const from = user.plan === "pro" && user.planRenewsAt && user.planRenewsAt > new Date() ? user.planRenewsAt : new Date();
    const renewsAt = new Date(from.getTime() + order.days * 24 * 60 * 60_000);
    await this.prisma.$transaction([
      this.prisma.paymentOrder.update({ where: { id: order.id }, data: { status: "paid", providerPaymentId: paymentId, paidAt: new Date() } }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { plan: "pro", paymentProvider: "razorpay", planRenewsAt: renewsAt, planCancelsAtPeriodEnd: true, subscriptionStatus: "active" },
      }),
    ]);
    this.logger.log(`Razorpay payment ${paymentId} verified: ${user.id} is Pro until ${renewsAt.toISOString()}`);
    return { plan: "pro", renewsAt: renewsAt.toISOString(), alreadyApplied: false };
  }

  private signatureMatches(payload: string, signature: string): boolean {
    const expected = createHmac("sha256", this.config.get("RAZORPAY_KEY_SECRET", { infer: true })!).update(payload).digest("hex");
    const given = Buffer.from(signature);
    const mine = Buffer.from(expected);
    return given.length === mine.length && timingSafeEqual(given, mine);
  }

  private async call(path: string, body: unknown): Promise<Record<string, unknown>> {
    const auth = Buffer.from(`${this.config.get("RAZORPAY_KEY_ID", { infer: true })}:${this.config.get("RAZORPAY_KEY_SECRET", { infer: true })}`).toString("base64");
    let response: Response;
    try {
      response = await this.fetchImpl(`${API}${path}`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`Razorpay unreachable: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException("Payments are unavailable right now. Please try again.");
    }
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const description = (json.error as { description?: string } | undefined)?.description ?? `HTTP ${response.status}`;
      this.logger.warn(`Razorpay refused ${path}: ${description}`);
      if (response.status === 401) throw new ServiceUnavailableException("Payments aren't set up correctly on this server.");
      throw new ServiceUnavailableException("Payments are unavailable right now. Please try again.");
    }
    return json;
  }

  private assertConfigured() {
    if (!this.configured) throw new ServiceUnavailableException("Paying in rupees isn't set up on this server yet.");
  }
}

/** Pro bought with Razorpay simply ends; nothing is auto-debited, so an expired plan drops to Free on next use. */
export function razorpayPlanExpired(user: Pick<User, "plan" | "paymentProvider" | "planRenewsAt">): boolean {
  return user.plan === "pro" && user.paymentProvider === "razorpay" && Boolean(user.planRenewsAt && user.planRenewsAt <= new Date());
}
