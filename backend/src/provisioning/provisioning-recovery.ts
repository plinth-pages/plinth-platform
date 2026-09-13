import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import {
  PROVISION_JOB_OPTIONS,
  PROVISIONING_QUEUE,
  RECOVERY_BATCH,
  RECOVERY_EVERY_MS,
  STALE_PROVISIONING_MS,
  provisionJobId,
  type ProvisionJobData,
} from "./provisioning.constants";

/**
 * Finds portfolios stuck in `provisioning` — a lost enqueue, a crashed worker, a job dropped during a
 * deploy — and queues them again. Re-queueing a portfolio whose job is still alive is a no-op, because the
 * job id is derived from the portfolio id.
 */
@Injectable()
export class ProvisioningRecovery {
  private readonly logger = new Logger(ProvisioningRecovery.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(PROVISIONING_QUEUE) private readonly queue: Queue<ProvisionJobData>,
  ) {}

  async run(now = new Date()): Promise<{ requeued: string[] }> {
    const stale = await this.prisma.portfolio.findMany({
      where: { status: "provisioning", updatedAt: { lt: new Date(now.getTime() - STALE_PROVISIONING_MS) } },
      orderBy: { updatedAt: "asc" },
      take: RECOVERY_BATCH,
      select: { id: true },
    });

    for (const { id } of stale) {
      await this.queue.add("provision", { portfolioId: id }, { jobId: provisionJobId(id), ...PROVISION_JOB_OPTIONS });
      // Touch it so the next tick does not pick it up again before the job has had a chance to run.
      await this.prisma.portfolio.update({ where: { id }, data: { updatedAt: now } });
    }

    if (stale.length) this.logger.warn(`Re-queued ${stale.length} stuck portfolio(s)`);
    return { requeued: stale.map((p) => p.id) };
  }
}

/** Worker only: registers the recurring recovery job with BullMQ on boot. */
@Injectable()
export class ProvisioningScheduler implements OnModuleInit {
  constructor(@InjectQueue(PROVISIONING_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler("provisioning-recovery", { every: RECOVERY_EVERY_MS }, { name: "recover" });
  }
}
