import { Body, ConflictException, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import { PortfolioRole, type User } from "@prisma/client";
import type { PortfolioResponse, PortfoliosResponse } from "@plinth-pages/shared";
import { z } from "zod";
import { CurrentUser } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { PortfolioLimitReached, PortfoliosService } from "./portfolios.service";

const createPortfolioBody = z.object({ role: z.nativeEnum(PortfolioRole) });

@Controller("portfolios")
@UseGuards(SessionGuard)
export class PortfoliosController {
  constructor(private readonly portfolios: PortfoliosService) {}

  @Post()
  async create(@CurrentUser() user: User, @Body() body: unknown): Promise<PortfolioResponse> {
    const parsed = createPortfolioBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(`role must be one of: ${Object.values(PortfolioRole).join(", ")}`);
    }
    try {
      return { portfolio: this.portfolios.toSummary(await this.portfolios.create(user, parsed.data.role)) };
    } catch (error) {
      if (error instanceof PortfolioLimitReached) {
        throw new ConflictException({
          statusCode: 409,
          code: "PORTFOLIO_LIMIT",
          message: error.message,
          portfolioId: error.existingPortfolioId,
        });
      }
      throw error;
    }
  }

  @Get()
  async list(@CurrentUser() user: User): Promise<PortfoliosResponse> {
    const portfolios = await this.portfolios.list(user);
    return { portfolios: portfolios.map((p) => this.portfolios.toSummary(p)) };
  }

  @Get(":id")
  async get(@CurrentUser() user: User, @Param("id") id: string): Promise<PortfolioResponse> {
    return { portfolio: this.portfolios.toSummary(await this.portfolios.get(user, id)) };
  }

  @Post(":id/retry")
  @HttpCode(202)
  async retry(@CurrentUser() user: User, @Param("id") id: string): Promise<PortfolioResponse> {
    return { portfolio: this.portfolios.toSummary(await this.portfolios.retry(user, id)) };
  }
}
