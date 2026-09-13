import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { IntegrationRequestResponse, IntegrationsResponse, ValidatePropsResponse } from "@plinth-pages/shared";
import { CurrentUser } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { CatalogueService } from "./catalogue.service";
import { IntegrationRequestsService } from "./integration-requests.service";
import { PLANNED_INTEGRATIONS } from "./planned-integrations";

@Controller("integrations")
@UseGuards(SessionGuard)
export class CatalogueController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly requests: IntegrationRequestsService,
  ) {}

  /** Everything installable, plus what's planned and can be requested. */
  @Get()
  async list(@CurrentUser() user: User): Promise<IntegrationsResponse> {
    const [integrations, requestedKeys] = await Promise.all([this.catalogue.list(), this.requests.keysFor(user)]);
    const available = new Set(integrations.map((entry) => entry.id));
    const requested = new Set(requestedKeys);
    return {
      integrations,
      planned: PLANNED_INTEGRATIONS.filter((entry) => !available.has(entry.id)).map((entry) => ({ ...entry, requested: requested.has(entry.id) })),
      requestedKeys,
    };
  }

  @Post("requests")
  @HttpCode(200)
  request(@CurrentUser() user: User, @Body() body: unknown): Promise<IntegrationRequestResponse> {
    return this.requests.request(user, body);
  }

  @Delete("requests/:key")
  withdraw(@CurrentUser() user: User, @Param("key") key: string): Promise<IntegrationRequestResponse> {
    return this.requests.withdraw(user, key);
  }

  /** Checks settings as the user types: the manifest's rules, then whether the account exists at the source. */
  @Post(":integrationId/validate")
  @HttpCode(200)
  validate(@Param("integrationId") id: string, @Body() body: { props?: unknown } | undefined): Promise<ValidatePropsResponse> {
    return this.catalogue.validate(id, body?.props);
  }
}
