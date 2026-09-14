import { Controller, Get, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { AdminIntegrationRequestsResponse, AdminMetricsResponse, AdminPingResponse, OperationStatus } from "@plinth-pages/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser, Roles, RolesGuard } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { IntegrationRequestsService } from "../catalogue/integration-requests.service";

@Controller("admin")
@UseGuards(SessionGuard, RolesGuard)
@Roles("admin")
export class AdminController {
  constructor(
    private readonly requests: IntegrationRequestsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Platform health at a glance for the super admin. */
  @Get("metrics")
  async metrics(): Promise<AdminMetricsResponse> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const [users, portfolios, sandboxesRunning, operations, deployments, copilot, installed, requests] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.portfolio.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.sandbox.count({ where: { status: "running" } }),
      this.prisma.operation.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.deployment.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.copilotMessage.aggregate({ where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }),
      this.prisma.installedIntegration.count(),
      this.prisma.integrationRequest.count(),
    ]);
    const byPortfolio = Object.fromEntries(portfolios.map((row) => [row.status, row._count._all]));
    const statuses: OperationStatus[] = ["queued", "staging", "checking", "applying", "applied", "rejected", "reverted", "failed"];
    const byOperation = Object.fromEntries(operations.map((row) => [row.status, row._count._all]));
    const byDeployment = Object.fromEntries(deployments.map((row) => [row.status, row._count._all]));
    return {
      users,
      portfolios: {
        total: portfolios.reduce((sum, row) => sum + row._count._all, 0),
        ready: byPortfolio.ready ?? 0,
        provisioning: byPortfolio.provisioning ?? 0,
        failed: byPortfolio.failed ?? 0,
      },
      sandboxesRunning,
      operations7d: Object.fromEntries(statuses.map((status) => [status, byOperation[status] ?? 0])) as Record<OperationStatus, number>,
      deployments7d: { ready: byDeployment.ready ?? 0, failed: byDeployment.failed ?? 0 },
      copilot7d: { messages: copilot._count._all, inputTokens: copilot._sum.inputTokens ?? 0, outputTokens: copilot._sum.outputTokens ?? 0 },
      integrations: { installed, requests },
    };
  }

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
