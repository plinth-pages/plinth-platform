import { Controller, Get, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { AdminIntegrationRequestsResponse, AdminPingResponse } from "@plinth-pages/shared";
import { CurrentUser, Roles, RolesGuard } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { IntegrationRequestsService } from "../catalogue/integration-requests.service";

@Controller("admin")
@UseGuards(SessionGuard, RolesGuard)
@Roles("admin")
export class AdminController {
  constructor(private readonly requests: IntegrationRequestsService) {}

  @Get("ping")
  ping(@CurrentUser() user: User): AdminPingResponse {
    return { ok: true, role: user.role };
  }

  /** Which integrations people want most, so the next codemods are the ones that matter. */
  @Get("integration-requests")
  integrationRequests(): Promise<AdminIntegrationRequestsResponse> {
    return this.requests.stats();
  }
}
