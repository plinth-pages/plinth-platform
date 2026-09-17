import { InjectQueue } from "@nestjs/bullmq";
import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { Queue } from "bullmq";
import type { User } from "@prisma/client";
import type { AdminIntegrationRequestsResponse, AdminMetricsResponse, AdminPingResponse, OperationStatus } from "@plinth-pages/shared";
import { PLANS } from "../billing/plans";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser, Roles, RolesGuard } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { IntegrationRequestsService } from "../catalogue/integration-requests.service";
import { OPERATIONS_QUEUE } from "../operations/operations.constants";
import { PROVISIONING_QUEUE, provisionJobId } from "../provisioning/provisioning.constants";
import { SANDBOX_QUEUE } from "../sandbox/sandbox.constants";
import { WORKSPACE_QUEUE } from "../workspace/workspace.constants";
import { PING_QUEUE } from "../queue/queue.constants";

@Controller("admin")
@UseGuards(SessionGuard, RolesGuard)
@Roles("admin")
export class AdminController {
  constructor(
    private readonly requests: IntegrationRequestsService,
    private readonly prisma: PrismaService,
    @InjectQueue(PROVISIONING_QUEUE) private readonly provisioning: Queue,
    @InjectQueue(OPERATIONS_QUEUE) private readonly operations: Queue,
    @InjectQueue(SANDBOX_QUEUE) private readonly sandbox: Queue,
    @InjectQueue(WORKSPACE_QUEUE) private readonly workspace: Queue,
    @InjectQueue(PING_QUEUE) private readonly pingQueue: Queue,
  ) {}

  /**
   * Queue health for diagnosing jobs that never run: counts per state, and where each still-provisioning portfolio's
   * job actually is. A portfolio whose job is missing, or sits in waiting while nothing becomes active, points at the
   * worker; one stuck in active points at the job itself.
   */
  @Get("queues")
  async queues() {
    const queues = [this.provisioning, this.operations, this.sandbox, this.workspace, this.pingQueue];
    const counts = await Promise.all(
      queues.map(async (queue) => ({
        queue: queue.name,
        paused: await queue.isPaused(),
        counts: await queue.getJobCounts("waiting", "prioritized", "active", "delayed", "failed", "completed"),
      })),
    );
    const stuck = await this.prisma.portfolio.findMany({
      where: { status: "provisioning" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, provisionAttempts: true, createdAt: true, updatedAt: true },
    });
    const provisioning = await Promise.all(
      stuck.map(async (portfolio) => {
        const job = await this.provisioning.getJob(provisionJobId(portfolio.id));
        return {
          ...portfolio,
          job: job
            ? {
                state: await job.getState(),
                attemptsMade: job.attemptsMade,
                processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
                failedReason: job.failedReason || null,
              }
            : null,
        };
      }),
    );
    return { checkedAt: new Date().toISOString(), counts, provisioning };
  }

  /** Platform health at a glance for the super admin, over `?days=` (7, 30, 90 or 365; 30 by default). */
  @Get("metrics")
  async metrics(@Query("days") daysParam?: string): Promise<AdminMetricsResponse> {
    const days = ([7, 30, 90, 365] as const).find((d) => String(d) === daysParam) ?? 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const [plans, signups, upgrades, ai, aiByModel, aiByProvider, fallbacks] = await Promise.all([
      this.prisma.user.groupBy({ by: ["plan"], _count: { _all: true } }),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.billingEvent.count({ where: { type: "checkout.session.completed", receivedAt: { gte: since } } }),
      this.prisma.copilotMessage.aggregate({ where: { role: "assistant", createdAt: { gte: since } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }),
      this.prisma.copilotMessage.groupBy({ by: ["model"], where: { role: "assistant", createdAt: { gte: since } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }),
      this.prisma.copilotMessage.groupBy({ by: ["provider"], where: { role: "assistant", createdAt: { gte: since } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }),
      this.prisma.copilotMessage.count({ where: { role: "assistant", fellBack: true, createdAt: { gte: since } } }),
    ]);
    const byPlan = Object.fromEntries(plans.map((row) => [row.plan, row._count._all]));
    const [users, portfolios, sandboxesRunning, operations, deployments, installed, requests] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.portfolio.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.sandbox.count({ where: { status: "running" } }),
      this.prisma.operation.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.deployment.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.installedIntegration.count(),
      this.prisma.integrationRequest.count(),
    ]);
    const byPortfolio = Object.fromEntries(portfolios.map((row) => [row.status, row._count._all]));
    const statuses: OperationStatus[] = ["queued", "staging", "checking", "applying", "applied", "rejected", "reverted", "failed"];
    const byOperation = Object.fromEntries(operations.map((row) => [row.status, row._count._all]));
    const byDeployment = Object.fromEntries(deployments.map((row) => [row.status, row._count._all]));
    return {
      days,
      users,
      portfolios: {
        total: portfolios.reduce((sum, row) => sum + row._count._all, 0),
        ready: byPortfolio.ready ?? 0,
        provisioning: byPortfolio.provisioning ?? 0,
        failed: byPortfolio.failed ?? 0,
      },
      sandboxesRunning,
      operations: Object.fromEntries(statuses.map((status) => [status, byOperation[status] ?? 0])) as Record<OperationStatus, number>,
      deployments: { ready: byDeployment.ready ?? 0, failed: byDeployment.failed ?? 0 },
      integrations: { installed, requests },
      plans: { free: byPlan.free ?? 0, pro: byPlan.pro ?? 0, mrrUsd: (byPlan.pro ?? 0) * PLANS.pro.priceUsd, upgrades, signups },
      ai: {
        messages: ai._count._all,
        inputTokens: ai._sum.inputTokens ?? 0,
        outputTokens: ai._sum.outputTokens ?? 0,
        byModel: aiByModel
          .map((row) => ({ model: row.model ?? "unknown", messages: row._count._all, tokens: (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0) }))
          .sort((a, b) => b.tokens - a.tokens),
        byProvider: aiByProvider
          .map((row) => ({ provider: row.provider ?? "unrecorded", messages: row._count._all, tokens: (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0) }))
          .sort((a, b) => b.tokens - a.tokens),
        fallbacks,
      },
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
