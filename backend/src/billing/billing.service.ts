import { BadRequestException, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { User } from "@prisma/client";
import type { BillingStatusResponse } from "@plinth-pages/shared";
import Stripe from "stripe";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { PLANS, PRO_STATUSES } from "./plans";

/** The Stripe client, or null when STRIPE_SECRET_KEY isn't set. Tests pass a fake. */
export const STRIPE = Symbol("STRIPE");

export function createStripe(config: ConfigService<Env, true>): Stripe | null {
  const key = config.get("STRIPE_SECRET_KEY", { infer: true });
  if (!key) return null;
  return new Stripe(key, { maxNetworkRetries: 2 });
}

/**
 * Pro subscriptions through Stripe Checkout. The database only changes from verified webhooks — never from the
 * success redirect, which anyone can open — so a plan is exactly what Stripe says it is.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Optional() @Inject(STRIPE) private readonly stripe: Stripe | null = null,
  ) {}

  /** Checkout needs only the secret key: returning from Stripe confirms the session directly. Webhooks keep renewals and cancellations current. */
  get configured() {
    return this.stripe !== null;
  }

  status(user: User): BillingStatusResponse {
    return {
      plan: user.plan,
      status: user.subscriptionStatus,
      renewsAt: user.planRenewsAt?.toISOString() ?? null,
      cancelsAtPeriodEnd: user.planCancelsAtPeriodEnd,
      priceUsd: PLANS.pro.priceUsd,
      limits: { free: PLANS.free.limits, pro: PLANS.pro.limits },
      checkoutAvailable: this.configured,
    };
  }

  async checkout(user: User): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    if (user.plan === "pro") throw new BadRequestException("You're already on Pro.");
    const customer = await this.customerFor(user, stripe);
    const adminUrl = this.config.get("ADMIN_URL", { infer: true });
    const priceId = this.config.get("STRIPE_PRO_PRICE_ID", { infer: true });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: user.id,
      metadata: { userId: user.id },
      subscription_data: { metadata: { userId: user.id } },
      line_items: [
        priceId
          ? { price: priceId, quantity: 1 }
          : {
              quantity: 1,
              price_data: { currency: "usd", unit_amount: PLANS.pro.priceUsd * 100, recurring: { interval: "month" }, product_data: { name: "Plinth Pro" } },
            },
      ],
      allow_promotion_codes: true,
      success_url: `${adminUrl}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${adminUrl}/billing?checkout=cancelled`,
    });
    if (!session.url) throw new ServiceUnavailableException("Stripe didn't return a checkout page.");
    return { url: session.url };
  }

  /**
   * Confirms a checkout the user just returned from by asking Stripe for the session — never trusting the redirect
   * itself. The session must belong to this user and be paid; the subscription is then applied like a webhook would.
   */
  async confirm(user: User, sessionId: unknown): Promise<BillingStatusResponse> {
    const stripe = this.requireStripe();
    if (typeof sessionId !== "string" || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) throw new BadRequestException("That checkout session isn't valid.");
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.client_reference_id !== user.id) throw new BadRequestException("That checkout session belongs to a different account.");
    if (session.status === "complete" && typeof session.subscription === "string") {
      await this.applySubscription(await stripe.subscriptions.retrieve(session.subscription), user.id);
    }
    return this.status(await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } }));
  }

  /** Stripe's hosted page for changing payment details, invoices and cancelling. */
  async portal(user: User): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    if (!user.stripeCustomerId) throw new BadRequestException("There's no subscription to manage yet.");
    const session = await stripe.billingPortal.sessions.create({ customer: user.stripeCustomerId, return_url: `${this.config.get("ADMIN_URL", { infer: true })}/billing` });
    return { url: session.url };
  }

  /** Verifies and applies a webhook. Returns false for a duplicate delivery. */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<boolean> {
    const stripe = this.requireStripe();
    const secret = this.config.get("STRIPE_WEBHOOK_SECRET", { infer: true });
    if (!secret) throw new ServiceUnavailableException("Webhooks aren't configured (STRIPE_WEBHOOK_SECRET).");
    if (!rawBody || !signature || !secret) throw new BadRequestException("Missing webhook signature.");
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException("Invalid webhook signature.");
    }

    const already = await this.prisma.billingEvent.findUnique({ where: { id: event.id } });
    if (already) return false;

    let userId: string | null = null;
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        userId = session.client_reference_id ?? session.metadata?.userId ?? null;
        if (userId && typeof session.subscription === "string") {
          await this.applySubscription(await stripe.subscriptions.retrieve(session.subscription), userId);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        userId = await this.applySubscription(event.data.object as Stripe.Subscription);
        break;
      }
      default:
        break;
    }
    await this.prisma.billingEvent.create({ data: { id: event.id, type: event.type, userId } }).catch(() => undefined);
    return true;
  }

  /** Makes the user's plan match a subscription. Finds the user by metadata, then by Stripe customer. */
  private async applySubscription(subscription: Stripe.Subscription, knownUserId?: string): Promise<string | null> {
    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const user =
      (knownUserId && (await this.prisma.user.findUnique({ where: { id: knownUserId } }))) ||
      (subscription.metadata?.userId && (await this.prisma.user.findUnique({ where: { id: subscription.metadata.userId } }))) ||
      (await this.prisma.user.findUnique({ where: { stripeCustomerId: customerId } }));
    if (!user) {
      this.logger.warn(`Subscription ${subscription.id} doesn't match a user`);
      return null;
    }
    // A newer subscription replaces this one; an old one ending doesn't downgrade a user who has resubscribed.
    if (user.stripeSubscriptionId && user.stripeSubscriptionId !== subscription.id && !PRO_STATUSES.has(subscription.status)) return user.id;

    const periodEnd = subscription.items?.data?.[0]?.current_period_end;
    const pro = PRO_STATUSES.has(subscription.status);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        plan: pro ? "pro" : "free",
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        planRenewsAt: periodEnd ? new Date(periodEnd * 1000) : null,
        planCancelsAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      },
    });
    this.logger.log(`User ${user.id} is now ${pro ? "pro" : "free"} (subscription ${subscription.status})`);
    return user.id;
  }

  private async customerFor(user: User, stripe: Stripe): Promise<string> {
    if (user.stripeCustomerId) return user.stripeCustomerId;
    const customer = await stripe.customers.create({ email: user.email ?? undefined, name: user.name ?? undefined, metadata: { userId: user.id } });
    await this.prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
    return customer.id;
  }

  private requireStripe(): Stripe {
    if (!this.stripe) throw new ServiceUnavailableException("Billing isn't set up on this server yet.");
    return this.stripe;
  }
}
