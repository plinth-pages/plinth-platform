import { BadRequestException, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PromoCode, User } from "@prisma/client";
import type { BillingPass, RazorpayOrderResponse, RazorpayVerifyResponse } from "@plinth-pages/shared";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { DAY_MS, passById, paymentsConfigured, proPasses } from "./passes";
import { PromoCodes } from "./promo-codes";

/** Lets tests answer for Razorpay without the network. */
export const RAZORPAY_FETCH = Symbol("RAZORPAY_FETCH");

const API = "https://api.razorpay.com/v1";
/** Razorpay's own floor, and ours: a smaller order is a mistake somewhere. */
const MIN_AMOUNT = 100;
const TIMEOUT_MS = 15_000;

const orderBody = z.object({
  passId: z.string().trim().max(24).optional(),
  promoCode: z.string().trim().max(30).optional(),
});

const verifyBody = z.object({
  razorpay_order_id: z.string().min(5).max(64),
  razorpay_payment_id: z.string().min(5).max(64),
  razorpay_signature: z.string().min(16).max(256),
});

/**
 * How Pro is bought, through Razorpay Standard Checkout: the browser opens Razorpay's modal for an order created here,
 * and Pro is granted only once the returned signature is verified with the key secret — which never leaves the server.
 * Every purchase is a pass: one payment for a stretch of days (see `passes.ts`), so nothing is auto-debited, there is
 * no card kept on file and there is no subscription to cancel. Stripe remains only for accounts that subscribed there
 * before this became the way to pay.
 */
@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly promos: PromoCodes,
    @Optional() @Inject(RAZORPAY_FETCH) fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return paymentsConfigured(this.config);
  }

  /** What Pro can be bought as, for the billing page. */
  get passes(): BillingPass[] {
    return proPasses(this.config);
  }

  /** What to charge for a pass, after any promo code. Razorpay has no view of our codes, so the discount comes off the amount. */
  private async priceFor(pass: BillingPass, code: string | undefined): Promise<{ amount: number; promo: PromoCode | null }> {
    if (!code) return { amount: pass.amount, promo: null };

    const promo = await this.promos.findUsable(code);
    const amount = Math.max(MIN_AMOUNT, Math.round((pass.amount * (100 - promo.percentOff)) / 100));
    return { amount, promo };
  }

  /** Step 1: create the order Razorpay's modal will collect payment for. */
  async createOrder(user: User, body?: unknown): Promise<RazorpayOrderResponse> {
    this.assertConfigured();
    if (user.plan === "pro" && user.paymentProvider === "stripe" && user.subscriptionStatus !== "canceled") {
      throw new BadRequestException("You already have a card subscription. Cancel it from the billing page first, then buy a pass.");
    }

    const parsed = orderBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException("We couldn't read that request. Please try again.");
    const pass = passById(this.config, parsed.data.passId);
    if (!pass) throw new BadRequestException({ statusCode: 400, code: "PASS_UNKNOWN", message: "That option isn't available." });

    const promoCode = parsed.data.promoCode || undefined;
    const { amount, promo } = await this.priceFor(pass, promoCode);
    // Razorpay caps the receipt at 40 characters; the row id is ours to trace the payment by.
    const receipt = `plinth_${Date.now().toString(36)}_${user.id.slice(-8)}`.slice(0, 40);

    const created = await this.call("/orders", {
      amount,
      currency: pass.currency,
      receipt,
      notes: { userId: user.id, plan: "pro", pass: pass.id, days: String(pass.days), ...(promo ? { promoCode: promo.code } : {}) },
    });
    const orderId = String(created.id ?? "");
    if (!orderId) throw new ServiceUnavailableException("Razorpay didn't return an order.");

    await this.prisma.paymentOrder.create({
      data: { userId: user.id, providerOrderId: orderId, amount, currency: pass.currency, days: pass.days, promoCode: promo?.code ?? null },
    });
    this.logger.log(`Created Razorpay order ${orderId} for ${user.id} (${pass.id}, ${amount} ${pass.currency}${promo ? `, ${promo.code}` : ""})`);

    return {
      orderId,
      amount,
      currency: pass.currency,
      keyId: this.config.get("RAZORPAY_KEY_ID", { infer: true })!,
      days: pass.days,
      passId: pass.id,
      passLabel: pass.label,
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
    const renewsAt = new Date(from.getTime() + order.days * DAY_MS);
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
    if (!this.configured) throw new ServiceUnavailableException("Payments aren't set up on this server yet.");
  }
}

/** A pass simply ends; nothing is auto-debited, so an expired plan drops to Free on next use. */
export function razorpayPlanExpired(user: Pick<User, "plan" | "paymentProvider" | "planRenewsAt">): boolean {
  return user.plan === "pro" && user.paymentProvider === "razorpay" && Boolean(user.planRenewsAt && user.planRenewsAt <= new Date());
}
