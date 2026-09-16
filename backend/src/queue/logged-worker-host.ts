import { WorkerHost } from "@nestjs/bullmq";
import { Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type { Job, Worker } from "bullmq";

/**
 * Shared by every queue consumer, so none of them fail silently: the worker's own errors, stalled jobs and failed
 * attempts are always logged, and job starts too for queues where each job matters (`logStarts`). Without this a job
 * that never starts and one that hangs look the same in the logs — nothing at all.
 */
export abstract class LoggedWorkerHost extends WorkerHost implements OnApplicationBootstrap {
  protected readonly queueLogger = new Logger(this.constructor.name);
  /** Log every job as it starts. Off for high-volume queues whose jobs are routine. */
  protected readonly logStarts: boolean = false;

  onApplicationBootstrap(): void {
    const worker = this.worker as Worker | undefined;
    if (!worker) {
      this.queueLogger.error("No BullMQ worker was attached to this processor — its queue will never be consumed.");
      return;
    }
    worker.on("error", (error) => this.queueLogger.error(`Worker error on "${worker.name}": ${error.message}`));
    worker.on("stalled", (jobId) => this.queueLogger.warn(`Job ${jobId} on "${worker.name}" stalled and will be retried`));
    worker.on("failed", (job: Job | undefined, error) => {
      const attempt = job ? ` (attempt ${job.attemptsMade} of ${job.opts.attempts ?? 1})` : "";
      this.queueLogger.warn(`Job ${job?.id ?? "?"} "${job?.name ?? "?"}" failed${attempt}: ${error.message}`);
    });
    if (this.logStarts) {
      worker.on("active", (job: Job) => {
        if (!job.repeatJobKey) this.queueLogger.log(`Started ${job.name} ${job.id}`);
      });
    }
    this.queueLogger.log(`Consuming "${worker.name}" (concurrency ${worker.concurrency})`);
  }
}

/**
 * Worker options every processor shares. BullMQ wakes a blocked worker as soon as a job is added, so a long block
 * while the queue is empty costs no latency — it only cuts idle Redis commands, which a per-command-billed Redis
 * (Upstash) charges for.
 */
export const WORKER_DEFAULTS = { drainDelay: 30 } as const;
