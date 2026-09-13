import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { PROVISIONING_QUEUE } from "../provisioning/provisioning.constants";
import { SANDBOX_QUEUE } from "../sandbox/sandbox.constants";
import { PING_QUEUE } from "./queue.constants";

function redisConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    // BullMQ workers block on Redis; a per-request retry limit would make them throw instead of wait.
    maxRetriesPerRequest: null,
  };
}

/** Registers queues. Both roles import this: the api enqueues, the worker consumes. */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: redisConnection(config.get("REDIS_URL", { infer: true })),
      }),
    }),
    BullModule.registerQueue({ name: PING_QUEUE }, { name: PROVISIONING_QUEUE }, { name: SANDBOX_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
