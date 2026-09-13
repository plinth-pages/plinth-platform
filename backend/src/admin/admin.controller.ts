import { Controller, Get, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { AdminPingResponse } from "@plinth/shared";
import { CurrentUser, Roles, RolesGuard } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";

@Controller("admin")
@UseGuards(SessionGuard, RolesGuard)
@Roles("admin")
export class AdminController {
  @Get("ping")
  ping(@CurrentUser() user: User): AdminPingResponse {
    return { ok: true, role: user.role };
  }
}
