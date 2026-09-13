import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { InstalledIntegrationsResponse, OperationResponse } from "@plinth-pages/shared";
import { CurrentUser } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { IntegrationsService } from "./integrations.service";

/** Installing, moving and removing integrations. Each change is an operation: queued here, run by the safety net. */
@Controller("portfolios/:id/integrations")
@UseGuards(SessionGuard)
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  list(@CurrentUser() user: User, @Param("id") id: string): Promise<InstalledIntegrationsResponse> {
    return this.integrations.list(user, id);
  }

  @Post()
  @HttpCode(202)
  async install(@CurrentUser() user: User, @Param("id") id: string, @Body() body: unknown): Promise<OperationResponse> {
    return { operation: await this.integrations.install(user, id, body) };
  }

  @Patch(":integrationId")
  @HttpCode(202)
  async move(@CurrentUser() user: User, @Param("id") id: string, @Param("integrationId") integrationId: string, @Body() body: unknown): Promise<OperationResponse> {
    return { operation: await this.integrations.move(user, id, integrationId, body) };
  }

  @Delete(":integrationId")
  @HttpCode(202)
  async uninstall(@CurrentUser() user: User, @Param("id") id: string, @Param("integrationId") integrationId: string): Promise<OperationResponse> {
    return { operation: await this.integrations.uninstall(user, id, integrationId) };
  }
}
