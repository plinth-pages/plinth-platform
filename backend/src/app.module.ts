import { DynamicModule, Global, Module } from "@nestjs/common";
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
import { PortfolioEventsHub } from "./events/portfolio-events.hub";
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
    GitHubAppSetupController,
  ],
  providers: [DevOnlyGuard, PortfoliosService, PreviewService, WorkspaceService, PortfolioEventsHub, ...previewApiProviders],
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
