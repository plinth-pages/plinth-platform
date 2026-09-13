import { getQueueToken } from "@nestjs/bullmq";
import { DynamicModule, Global, Module } from "@nestjs/common";
import type { Queue } from "bullmq";
import { ConfigModule } from "@nestjs/config";
import { AdminController } from "./admin/admin.controller";
import { AuthModule } from "./auth/auth.module";
import { DevOnlyGuard } from "./common/dev-only.guard";
import { validateEnv } from "./config/env";
import { ORCHESTRATOR_ROLE, type OrchestratorRole } from "./config/role";
import { GitHubAppSetupController } from "./github/github-app-setup.controller";
import { GitHubModule } from "./github/github.module";
import { HealthController } from "./health/health.controller";
import { JobsController } from "./jobs/jobs.controller";
import { PingProcessor } from "./jobs/ping.processor";
import { PORTFOLIO_EVENTS, RedisPortfolioEventPublisher } from "./events/portfolio-events";
import { PortfolioEventsHub } from "./events/portfolio-events.hub";
import { GitSync } from "./operations/git-sync";
import { OperationRunner, PUSH_RETRIES } from "./operations/operation-runner";
import { DevEditController, OperationsController } from "./operations/operations.controller";
import { OPERATIONS_QUEUE } from "./operations/operations.constants";
import { OperationsProcessor, QueuedPushRetries } from "./operations/operations.processor";
import { OperationsService } from "./operations/operations.service";
import { PENDING_PUSHES } from "./operations/pending-pushes";
import { previewApiProviders } from "./preview/preview.providers";
import { PrismaModule } from "./prisma/prisma.module";
import { PortfoliosController } from "./provisioning/portfolios.controller";
import { PortfoliosService } from "./provisioning/portfolios.service";
import { DEFAULT_PROVISIONER_OPTIONS, PROVISIONER_OPTIONS, Provisioner } from "./provisioning/provisioner";
import { ProvisioningRecovery, ProvisioningScheduler } from "./provisioning/provisioning-recovery";
import { ProvisioningProcessor } from "./provisioning/provisioning.processor";
import { QueueModule } from "./queue/queue.module";
import { PreviewController } from "./sandbox/preview.controller";
import { PreviewService } from "./sandbox/preview.service";
import { QueuedSandboxWaker, SANDBOX_WAKER } from "./sandbox/sandbox-waker";
import { sandboxWorkerProviders } from "./sandbox/sandbox.providers";
import { WorkspaceReader } from "./workspace/workspace-reader";
import { WorkspaceController } from "./workspace/workspace.controller";
import { WorkspaceProcessor } from "./workspace/workspace.processor";
import { WorkspaceService } from "./workspace/workspace.service";

@Global()
@Module({})
class RoleModule {
  static forRole(role: OrchestratorRole): DynamicModule {
    return {
      module: RoleModule,
      providers: [{ provide: ORCHESTRATOR_ROLE, useValue: role }],
      exports: [ORCHESTRATOR_ROLE],
    };
  }
}

/** HTTP and the preview proxy. Must never register a queue processor or cron — see architecture.spec.ts. */
@Module({
  imports: [QueueModule, AuthModule],
  controllers: [
    HealthController,
    AdminController,
    JobsController,
    PortfoliosController,
    PreviewController,
    WorkspaceController,
    OperationsController,
    DevEditController,
    GitHubAppSetupController,
  ],
  providers: [
    DevOnlyGuard,
    PortfoliosService,
    PreviewService,
    WorkspaceService,
    OperationsService,
    PortfolioEventsHub,
    ...previewApiProviders,
    {
      provide: PORTFOLIO_EVENTS,
      inject: [getQueueToken(OPERATIONS_QUEUE)],
      useFactory: (queue: Queue) => new RedisPortfolioEventPublisher(async () => (await queue.client) as never),
    },
  ],
})
export class ApiModule {}

/** Queue consumers, schedulers, and anything that acts on GitHub as the App or on E2B. No controllers. */
@Module({
  imports: [QueueModule, GitHubModule],
  providers: [
    PingProcessor,
    ProvisioningProcessor,
    Provisioner,
    ProvisioningRecovery,
    ProvisioningScheduler,
    { provide: PROVISIONER_OPTIONS, useValue: DEFAULT_PROVISIONER_OPTIONS },
    ...sandboxWorkerProviders,
    WorkspaceProcessor,
    WorkspaceReader,
    OperationsProcessor,
    OperationRunner,
    GitSync,
    { provide: PENDING_PUSHES, useExisting: GitSync },
    { provide: PUSH_RETRIES, useClass: QueuedPushRetries },
    { provide: SANDBOX_WAKER, useClass: QueuedSandboxWaker },
  ],
})
export class WorkerModule {}

@Module({})
export class AppModule {
  static forRole(role: OrchestratorRole): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          validate: validateEnv,
          ignoreEnvFile: process.env.NODE_ENV === "test",
        }),
        RoleModule.forRole(role),
        PrismaModule,
        role === "api" ? ApiModule : WorkerModule,
      ],
    };
  }
}
