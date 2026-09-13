import { DynamicModule, Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AdminController } from "./admin/admin.controller";
import { AuthModule } from "./auth/auth.module";
import { DevOnlyGuard } from "./common/dev-only.guard";
import { validateEnv } from "./config/env";
import { ORCHESTRATOR_ROLE, type OrchestratorRole } from "./config/role";
import { HealthController } from "./health/health.controller";
import { JobsController } from "./jobs/jobs.controller";
import { PingProcessor } from "./jobs/ping.processor";
import { PrismaModule } from "./prisma/prisma.module";
import { QueueModule } from "./queue/queue.module";

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

/** HTTP only. Must never register a queue processor or cron — see architecture.spec.ts. */
@Module({
  imports: [QueueModule, AuthModule],
  controllers: [HealthController, AdminController, JobsController],
  providers: [DevOnlyGuard],
})
export class ApiModule {}

/** Queue consumers, and later crons and sandbox sweeps. No controllers. */
@Module({
  imports: [QueueModule],
  providers: [PingProcessor],
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
