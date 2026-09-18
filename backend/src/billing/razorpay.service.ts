import { BadRequestException, Inject, Injectable, Logger, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PaymentOrder, PromoCode, User } from "@prisma/client";
import type { BillingPass, RazorpayOrderResponse, RazorpayVerifyResponse } from "@plinth-pages/shared";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import type { Env } from "../config/env";
import { Alerts } from "../observability/alerts";
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

/** Only the parts of Razorpay's webhook we act on. */
const webhookBody = z.object({
  event: z.string().max(64),
  payload: z
    .object({
      payment: z.object({ entity: z.object({ id: z.string(), order_id: z.string().nullish(), amount: z.number().nullish(), status: z.string().nullish() }) }).optional(),
    })
    .optional(),
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
    @Optional() private readonly alerts: Alerts | null = null,
    @Optional() @Inject(RAZORPAY_FETCH) fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return paymentsConfigured(this.config);
  }

  private get keyId(): string {
    return (this.config.get("RAZORPAY_KEY_ID", { infer: true }) ?? "").trim();
  }

  private get keySecret(): string {
    return (this.config.get("RAZORPAY_KEY_SECRET", { infer: true }) ?? "").trim();
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
      keyId: this.keyId,
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

    const { applied, renewsAt } = await this.applyPayment(order, paymentId);
    return { plan: "pro", renewsAt: renewsAt?.toISOString() ?? null, alreadyApplied: !applied };
  }

  /**
   * Razorpay → Plinth, authenticated by the signature over the raw body rather than by a session. This is the safety
   * net for the browser never coming back — a closed tab, a dropped connection, a phone that slept during UPI — and
   * Razorpay retries it for hours, so a captured payment is granted whether or not anyone is still watching.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ event: string | null; applied: boolean }> {
    const secret = (this.config.get("RAZORPAY_WEBHOOK_SECRET", { infer: true }) ?? "").trim();
    if (!secret) throw new ServiceUnavailableException("Payment webhooks aren't set up on this server yet.");
    if (!rawBody?.length || !signature) throw new UnauthorizedException("Unsigned webhook.");
    if (!matches(createHmac("sha256", secret).update(rawBody).digest("hex"), signature)) {
      this.logger.warn("Rejected a Razorpay webhook: signature mismatch");
      throw new UnauthorizedException("Bad webhook signature.");
    }

    const parsed = webhookBody.safeParse(JSON.parse(rawBody.toString("utf8")) as unknown);
    if (!parsed.success) return { event: null, applied: false };
    const { event, payload } = parsed.data;
    // order.paid carries the same payment entity, so both events settle the order exactly once.
    if (event !== "payment.captured" && event !== "order.paid") return { event, applied: false };

    const payment = payload?.payment?.entity;
    if (!payment?.order_id) return { event, applied: false };
    const order = await this.prisma.paymentOrder.findUnique({ where: { providerOrderId: payment.order_id } });
    if (!order) {
      // Money taken for something we have no record of: worth a person looking, not worth failing the webhook.
      this.logger.warn(`Razorpay ${event} for unknown order ${payment.order_id} (payment ${payment.id})`);
      this.alerts?.send({ title: "Razorpay captured a payment for an unknown order", fields: { event, order: payment.order_id, payment: payment.id }, dedupeKey: `rzp:unknown:${payment.order_id}` });
      return { event, applied: false };
    }
    if (typeof payment.amount === "number" && payment.amount < order.amount) {
      this.logger.warn(`Razorpay ${event} paid ${payment.amount} of ${order.amount} for order ${order.providerOrderId}; not granting Pro`);
      this.alerts?.send({ title: "Razorpay payment is short of the order amount", fields: { paid: payment.amount, expected: order.amount, order: order.providerOrderId, user: order.userId }, dedupeKey: `rzp:short:${order.id}` });
      return { event, applied: false };
    }

    const { applied } = await this.applyPayment(order, payment.id);
    this.logger.log(`Razorpay webhook ${event} for order ${order.providerOrderId}: ${applied ? "Pro granted" : "already applied"}`);
    return { event, applied };
  }

  /**
   * Settle an order exactly once. The status change is the lock: whichever of the browser and the webhook claims the
   * row first is the one that extends the plan, so a payment confirmed twice never buys two passes.
   */
  private async applyPayment(order: PaymentOrder, paymentId: string): Promise<{ applied: boolean; renewsAt: Date | null }> {
    const claimed = await this.prisma.paymentOrder.updateMany({
      where: { id: order.id, status: { in: ["created", "failed"] } },
      data: { status: "paid", providerPaymentId: paymentId, paidAt: new Date() },
    });
    const user = await this.prisma.user.findUnique({ where: { id: order.userId } });
    if (!user) throw new BadRequestException({ statusCode: 400, code: "ORDER_UNKNOWN", message: "We couldn't find that payment." });
    if (claimed.count === 0) return { applied: false, renewsAt: user.planRenewsAt };

    const from = user.plan === "pro" && user.planRenewsAt && user.planRenewsAt > new Date() ? user.planRenewsAt : new Date();
    const renewsAt = new Date(from.getTime() + order.days * DAY_MS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { plan: "pro", paymentProvider: "razorpay", planRenewsAt: renewsAt, planCancelsAtPeriodEnd: true, subscriptionStatus: "active" },
    });
    this.logger.log(`Razorpay payment ${paymentId} applied: ${user.id} is Pro until ${renewsAt.toISOString()}`);
    return { applied: true, renewsAt };
  }

  private signatureMatches(payload: string, signature: string): boolean {
    return matches(createHmac("sha256", this.keySecret).update(payload).digest("hex"), signature);
  }

  private async call(path: string, body: unknown): Promise<Record<string, unknown>> {
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
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
      this.logger.warn(`Razorpay refused ${path} for key ${this.keyId.slice(0, 12)}…: ${description} (HTTP ${response.status})`);
      this.alerts?.send({
        title: response.status === 401 ? "Razorpay rejected our API key" : "Razorpay refused a request",
        error: description,
        fields: { keyId: `${this.keyId.slice(0, 12)}…`, status: response.status, path },
        dedupeKey: `rzp:refused:${response.status}`,
      });
      if (response.status === 401) throw new ServiceUnavailableException("Payments aren't set up correctly on this server.");
      throw new ServiceUnavailableException("Payments are unavailable right now. Please try again.");
    }
    return json;
  }

  private assertConfigured() {
    if (!this.configured) throw new ServiceUnavailableException("Payments aren't set up on this server yet.");
  }
}

/** Constant-time compare of two hex digests. */
function matches(expected: string, given: string): boolean {
  const mine = Buffer.from(expected);
  const theirs = Buffer.from(given.trim());
  return mine.length === theirs.length && timingSafeEqual(mine, theirs);
}

/** A pass simply ends; nothing is auto-debited, so an expired plan drops to Free on next use. */
export function razorpayPlanExpired(user: Pick<User, "plan" | "paymentProvider" | "planRenewsAt">): boolean {
  return user.plan === "pro" && user.paymentProvider === "razorpay" && Boolean(user.planRenewsAt && user.planRenewsAt <= new Date());
}
