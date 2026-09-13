import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { OPERATIONS_QUEUE } from "../operations/operations.constants";
import { PROVISIONING_QUEUE } from "../provisioning/provisioning.constants";
import { SANDBOX_QUEUE } from "../sandbox/sandbox.constants";
import { WORKSPACE_QUEUE } from "../workspace/workspace.constants";
import { PING_QUEUE } from "./queue.constants";
import { redisConnection } from "./redis-connection";

/** Registers queues. Both roles import this: the api enqueues, the worker consumes. */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: redisConnection(config.get("REDIS_URL", { infer: true })),
      }),
    }),
    BullModule.registerQueue(
      { name: PING_QUEUE },
      { name: PROVISIONING_QUEUE },
      { name: SANDBOX_QUEUE },
      { name: WORKSPACE_QUEUE },
      { name: OPERATIONS_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
