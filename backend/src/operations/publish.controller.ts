import { Controller, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import type { Deployment, User } from "@prisma/client";
import type { DeploymentSummary, OperationResponse, PublishStatusResponse } from "@plinth-pages/shared";
import { CurrentUser } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { OperationsService, toSummary } from "./operations.service";

@Controller("portfolios/:id/publish")
@UseGuards(SessionGuard)
export class PublishController {
  constructor(
    private readonly operations: OperationsService,
    private readonly workspace: WorkspaceService,
    private readonly prisma: PrismaService,
  ) {}

  /** Queues a publish and returns straight away; the worker builds and promotes draft to main. */
  @Post()
  @HttpCode(202)
  async publish(@CurrentUser() user: User, @Param("id") id: string): Promise<OperationResponse> {
    return { operation: await this.operations.submitPublish(user, id) };
  }

  @Get()
  async status(@CurrentUser() user: User, @Param("id") id: string): Promise<PublishStatusResponse> {
    const portfolio = await this.prisma.portfolio.findFirst({ where: { id, userId: user.id }, select: { id: true, status: true } });
    if (!portfolio) throw new NotFoundException("Portfolio not found");

    const [state, sandbox, publishing, lastDeployment] = await Promise.all([
      portfolio.status === "ready" ? this.workspace.publishState(id) : { unpublishedCount: 0, draftSha: null, mainSha: null },
      this.prisma.sandbox.findUnique({ where: { portfolioId: id }, select: { pendingPush: true } }),
      this.prisma.operation.findFirst({
        where: { portfolioId: id, type: "publish", status: { in: ["queued", "staging", "checking", "applying"] } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.deployment.findFirst({ where: { portfolioId: id }, orderBy: { createdAt: "desc" } }),
    ]);
    return {
      ...state,
      pendingPush: sandbox?.pendingPush ?? false,
      publishing: publishing ? toSummary(publishing) : null,
      lastDeployment: lastDeployment ? toDeployment(lastDeployment) : null,
      hostingConfigured: false,
    };
  }
}

function toDeployment(deployment: Deployment): DeploymentSummary {
  return {
    id: deployment.id,
    status: deployment.status,
    commitSha: deployment.commitSha,
    url: deployment.url,
    error: deployment.error,
    createdAt: deployment.createdAt.toISOString(),
    finishedAt: deployment.finishedAt?.toISOString() ?? null,
  };
}
