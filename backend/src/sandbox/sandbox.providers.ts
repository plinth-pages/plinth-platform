import { getQueueToken } from "@nestjs/bullmq";
import { Logger, type Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import type { Env } from "../config/env";
import { PORTFOLIO_EVENTS, RedisPortfolioEventPublisher } from "../events/portfolio-events";
import { GITHUB_APP_AUTH } from "../github/github.module";
import { createE2BApi } from "./e2b-api";
import { DEFAULT_E2B_DRIVER_TIMINGS, E2BDriver } from "./e2b.driver";
import { SANDBOX_DRIVER } from "./sandbox-driver";
import { RedisSandboxLocks, SANDBOX_LOCKS } from "./sandbox-locks";
import { SANDBOX_QUEUE, sandboxTimings } from "./sandbox.constants";
import { GIT_TOKENS } from "./git-tokens";
import { SANDBOX_LIFECYCLE_OPTIONS, SandboxLifecycle, type SandboxLifecycleOptions } from "./sandbox.lifecycle";
import { SandboxProcessor, SandboxScheduler } from "./sandbox.processor";

/** Worker only: everything that talks to E2B. */
export const sandboxWorkerProviders: Provider[] = [
  SandboxProcessor,
  SandboxScheduler,
  SandboxLifecycle,
  { provide: SANDBOX_LOCKS, useClass: RedisSandboxLocks },
  { provide: GIT_TOKENS, useExisting: GITHUB_APP_AUTH },
  {
    provide: PORTFOLIO_EVENTS,
    inject: [getQueueToken(SANDBOX_QUEUE)],
    // Publishing works on the queue's ordinary (non-blocking) connection.
    useFactory: (queue: Queue) => new RedisPortfolioEventPublisher(async () => (await queue.client) as never),
  },
  {
    provide: SANDBOX_DRIVER,
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>) =>
      new E2BDriver(createE2BApi(config.get("E2B_API_KEY", { infer: true })!), {
        template: config.get("E2B_TEMPLATE", { infer: true }),
        logger: new Logger(E2BDriver.name),
        ...DEFAULT_E2B_DRIVER_TIMINGS,
      }),
  },
  {
    provide: SANDBOX_LIFECYCLE_OPTIONS,
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>): SandboxLifecycleOptions => ({
      org: config.get("GITHUB_ORG", { infer: true }),
      timings: sandboxTimings({
        SANDBOX_IDLE_PAUSE_MINUTES: config.get("SANDBOX_IDLE_PAUSE_MINUTES", { infer: true }),
        SANDBOX_DESTROY_AFTER_PAUSED_HOURS: config.get("SANDBOX_DESTROY_AFTER_PAUSED_HOURS", { infer: true }),
        SANDBOX_ROTATE_AFTER_MINUTES: config.get("SANDBOX_ROTATE_AFTER_MINUTES", { infer: true }),
      }),
    }),
  },
];
