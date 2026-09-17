import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { AdminPromoCode, PromoCodePreview } from "@plinth-pages/shared";
import { CurrentUser, Roles, RolesGuard } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { PromoCodes } from "./promo-codes";

@Controller()
@UseGuards(SessionGuard)
export class PromoCodesController {
  constructor(private readonly promos: PromoCodes) {}

  /** What a code gives, so the billing page can show the discount before checkout. */
  @Get("billing/promo")
  preview(@Query("code") code: string | undefined): Promise<PromoCodePreview> {
    return this.promos.preview(code);
  }

  @Get("admin/promo-codes")
  @UseGuards(RolesGuard)
  @Roles("admin")
  async list(): Promise<{ codes: AdminPromoCode[] }> {
    return { codes: await this.promos.list() };
  }

  @Post("admin/promo-codes")
  @UseGuards(RolesGuard)
  @Roles("admin")
  async create(@CurrentUser() admin: User, @Body() body: unknown): Promise<{ code: AdminPromoCode }> {
    return { code: await this.promos.create(admin, body) };
  }

  @Post("admin/promo-codes/:id/deactivate")
  @HttpCode(204)
  @UseGuards(RolesGuard)
  @Roles("admin")
  deactivate(@Param("id") id: string): Promise<void> {
    return this.promos.deactivate(id);
  }
}
