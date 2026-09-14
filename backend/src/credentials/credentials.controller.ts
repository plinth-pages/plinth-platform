import { Body, Controller, Delete, Get, Param, Put, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { PortfolioCredentialsResponse } from "@plinth-pages/shared";
import { CurrentUser } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { CredentialsService } from "./credentials.service";

/** Keys for secret-backed integrations. Responses never contain a value — only names and masked hints. */
@Controller("portfolios/:id/credentials")
@UseGuards(SessionGuard)
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Get()
  list(@CurrentUser() user: User, @Param("id") id: string): Promise<PortfolioCredentialsResponse> {
    return this.credentials.list(user, id);
  }

  /** Verifies the keys with their provider, then stores them encrypted and syncs them to the preview and the live site. */
  @Put(":integrationId")
  connect(@CurrentUser() user: User, @Param("id") id: string, @Param("integrationId") integrationId: string, @Body() body: unknown): Promise<PortfolioCredentialsResponse> {
    return this.credentials.connect(user, id, integrationId, body);
  }

  /** Deletes the keys and removes them from the preview and the live site. */
  @Delete(":integrationId")
  disconnect(@CurrentUser() user: User, @Param("id") id: string, @Param("integrationId") integrationId: string): Promise<PortfolioCredentialsResponse> {
    return this.credentials.disconnect(user, id, integrationId);
  }
}
