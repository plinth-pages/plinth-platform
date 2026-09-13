import { Controller, Get, Inject } from "@nestjs/common";
import { ORCHESTRATOR_ROLE, type OrchestratorRole } from "../config/role";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ORCHESTRATOR_ROLE) private readonly role: OrchestratorRole,
  ) {}

  @Get()
  async health() {
    await this.prisma.$queryRaw`select 1`;
    return { status: "ok", role: this.role, database: "reachable" };
  }
}
