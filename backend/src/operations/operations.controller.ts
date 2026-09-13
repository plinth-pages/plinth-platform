import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { OperationResponse, OperationsResponse } from "@plinth-pages/shared";
import { CurrentUser } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { DevOnlyGuard } from "../common/dev-only.guard";
import { OperationsService } from "./operations.service";

@Controller("portfolios/:id/operations")
@UseGuards(SessionGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  list(@CurrentUser() user: User, @Param("id") id: string, @Query("limit") limit?: string): Promise<OperationsResponse> {
    return this.operations.list(user, id, limit ? Number(limit) || 20 : 20);
  }

  @Get(":operationId")
  async get(@CurrentUser() user: User, @Param("id") id: string, @Param("operationId") operationId: string): Promise<OperationResponse> {
    return { operation: await this.operations.get(user, id, operationId) };
  }
}

/**
 * Development only: runs an `edit` operation so the safety net can be exercised before the codemod engine and the
 * co-pilot exist. Removed before launch.
 */
@Controller("dev/portfolios/:id")
@UseGuards(DevOnlyGuard, SessionGuard)
export class DevEditController {
  constructor(private readonly operations: OperationsService) {}

  @Post("edit")
  @HttpCode(202)
  async edit(@CurrentUser() user: User, @Param("id") id: string, @Body() body: unknown): Promise<OperationResponse> {
    return { operation: await this.operations.submitEdit(user, id, body) };
  }
}
