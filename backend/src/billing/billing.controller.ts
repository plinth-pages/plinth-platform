import { Body, Controller, Get, Headers, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { BillingStatusResponse } from "@plinth-pages/shared";
import type { Request } from "express";
import { CurrentUser } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { BillingService } from "./billing.service";
import { PromoCodes } from "./promo-codes";
import { RazorpayService } from "./razorpay.service";

@Controller("billing")
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly promos: PromoCodes,
    private readonly razorpay: RazorpayService,
  ) {}

  @Get()
  @UseGuards(SessionGuard)
  status(@CurrentUser() user: User): BillingStatusResponse {
    return this.billing.status(user);
  }

  /** Returns a Stripe Checkout URL; the plan changes only when Stripe's webhook confirms payment. */
  @Post("checkout")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async checkout(@CurrentUser() user: User, @Body() body: { promoCode?: unknown } | undefined) {
    // A code applied on our page is checked here first, so a bad one is reported before Stripe opens.
    const promotionId = body?.promoCode ? await this.promos.promotionIdFor(body.promoCode) : undefined;
    return this.billing.checkout(user, promotionId);
  }

  /** Called when the user returns from Checkout: verifies the session with Stripe and applies the plan. */
  @Post("confirm")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  confirm(@CurrentUser() user: User, @Body() body: { sessionId?: unknown } | undefined) {
    return this.billing.confirm(user, body?.sessionId);
  }

  /** Razorpay step 1: an order for the modal to collect. */
  @Post("razorpay/order")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  createRazorpayOrder(@CurrentUser() user: User, @Body() body: unknown) {
    return this.razorpay.createOrder(user, body);
  }

  /** Razorpay step 3: check the signature, then grant Pro. */
  @Post("razorpay/verify")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  verifyRazorpay(@CurrentUser() user: User, @Body() body: unknown) {
    return this.razorpay.verify(user, body);
  }

  @Post("portal")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  portal(@CurrentUser() user: User) {
    return this.billing.portal(user);
  }

  /** Stripe → Plinth. Authenticated by the Stripe signature over the raw body, not by a session. */
  @Post("webhook")
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers("stripe-signature") signature: string | undefined) {
    const applied = await this.billing.handleWebhook(req.rawBody, signature);
    return { received: true, duplicate: !applied };
  }
}
