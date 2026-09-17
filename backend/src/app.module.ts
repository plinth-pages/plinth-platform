import { getQueueToken } from "@nestjs/bullmq";
import { DynamicModule, Global, Module } from "@nestjs/common";
import type { Queue } from "bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AdminController } from "./admin/admin.controller";
import { AdminUsersController } from "./admin/admin-users.controller";
import { LegalController } from "./legal/legal.controller";
import { AiService } from "./ai/ai.service";
import { AuthModule } from "./auth/auth.module";
import { BillingController } from "./billing/billing.controller";
import { BillingService, STRIPE, createStripe } from "./billing/billing.service";
import { PromoCodes } from "./billing/promo-codes";
import { PromoCodesController } from "./billing/promo-codes.controller";
import { CredentialSync, SECRET_ENVIRONMENT } from "./credentials/credential-sync";
import { CredentialsController } from "./credentials/credentials.controller";
import { CredentialsService } from "./credentials/credentials.service";
import { vaultProvider } from "./credentials/vault.provider";
import { VisitorCounterController } from "./credentials/visitor-counter.controller";
import { CopilotController } from "./copilot/copilot.controller";
import { CopilotPlanner } from "./copilot/copilot-planner";
import { CopilotService } from "./copilot/copilot.service";
import { CatalogueController } from "./catalogue/catalogue.controller";
import { CatalogueIngest } from "./catalogue/catalogue-ingest";
import { CatalogueService } from "./catalogue/catalogue.service";
import { IntegrationRequestsService } from "./catalogue/integration-requests.service";
import { DevOnlyGuard } from "./common/dev-only.guard";
import { validateEnv, type Env } from "./config/env";
import { ORCHESTRATOR_ROLE, type OrchestratorRole } from "./config/role";
import { GitHubAppSetupController } from "./github/github-app-setup.controller";
import { GitHubModule } from "./github/github.module";
import { HealthController } from "./health/health.controller";
import { JobsController } from "./jobs/jobs.controller";
import { PingProcessor } from "./jobs/ping.processor";
import { PORTFOLIO_EVENTS, RedisPortfolioEventPublisher } from "./events/portfolio-events";
import { PortfolioEventsHub } from "./events/portfolio-events.hub";
import { DeploymentTracker, HOSTING, PRODUCTION_SECRETS, VERCEL_CLIENT, VercelHosting, createVercelClient } from "./hosting/hosting";
import { Personaliser } from "./onboarding/personaliser";
import { GitSync } from "./operations/git-sync";
import { IntegrationPlanner } from "./operations/integration-planner";
import { IntegrationsController } from "./operations/integrations.controller";
import { IntegrationsService } from "./operations/integrations.service";
import { DEPLOYMENT_TRACKING, FOLLOW_UPS, OperationRunner, PUSH_RETRIES } from "./operations/operation-runner";
import { DevEditController, OperationsController } from "./operations/operations.controller";
import { OPERATIONS_QUEUE } from "./operations/operations.constants";
import { OperationsProcessor, QueuedDeploymentTracking, QueuedFollowUps, QueuedPushRetries } from "./operations/operations.processor";
import { OperationsService } from "./operations/operations.service";
import { PublishController } from "./operations/publish.controller";
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
    AdminUsersController,
    LegalController,
    JobsController,
    PortfoliosController,
    PreviewController,
    WorkspaceController,
    OperationsController,
    PublishController,
    CatalogueController,
    IntegrationsController,
    CopilotController,
    BillingController,
    PromoCodesController,
    CredentialsController,
    VisitorCounterController,
    DevEditController,
    GitHubAppSetupController,
  ],
  providers: [
    DevOnlyGuard,
    PortfoliosService,
    PreviewService,
    WorkspaceService,
    OperationsService,
    CatalogueService,
    IntegrationRequestsService,
    IntegrationsService,
    AiService,
    CopilotService,
    vaultProvider,
    CredentialsService,
    BillingService,
    PromoCodes,
    { provide: STRIPE, inject: [ConfigService], useFactory: createStripe },
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
    // Its only callers are the development-only job routes; in production it would just hold a Redis connection.
    ...(process.env.NODE_ENV === "production" ? [] : [PingProcessor]),
    ProvisioningProcessor,
    Provisioner,
    ProvisioningRecovery,
    ProvisioningScheduler,
    Personaliser,
    {
      provide: PROVISIONER_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        ...DEFAULT_PROVISIONER_OPTIONS,
        visibility: config.get("PORTFOLIO_REPO_VISIBILITY", { infer: true }),
      }),
    },
    ...sandboxWorkerProviders,
    WorkspaceProcessor,
    WorkspaceReader,
    OperationsProcessor,
    OperationRunner,
    IntegrationPlanner,
    CatalogueIngest,
    CatalogueService,
    AiService,
    CopilotPlanner,
    { provide: FOLLOW_UPS, useClass: QueuedFollowUps },
    vaultProvider,
    CredentialSync,
    { provide: SECRET_ENVIRONMENT, useExisting: CredentialSync },
    { provide: PRODUCTION_SECRETS, useExisting: CredentialSync },
    GitSync,
    { provide: PENDING_PUSHES, useExisting: GitSync },
    { provide: PUSH_RETRIES, useClass: QueuedPushRetries },
    { provide: SANDBOX_WAKER, useClass: QueuedSandboxWaker },
    { provide: VERCEL_CLIENT, inject: [ConfigService], useFactory: createVercelClient },
    { provide: HOSTING, useClass: VercelHosting },
    { provide: DEPLOYMENT_TRACKING, useClass: QueuedDeploymentTracking },
    DeploymentTracker,
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
