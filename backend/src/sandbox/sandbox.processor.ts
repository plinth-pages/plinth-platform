import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { DelayedError, UnrecoverableError, type Job, type Queue } from "bullmq";
import { GitHubRateLimitError } from "../github/github.errors";
import { SandboxLifecycle, errorMessage } from "./sandbox.lifecycle";
import { BUSY_RETRY_MS, SANDBOX_QUEUE, SWEEP_EVERY_MS, type SandboxJobData } from "./sandbox.constants";

// Most of a sandbox job is waiting on E2B or the dev server, so several can run side by side.
@Processor(SANDBOX_QUEUE, { concurrency: 5 })
export class SandboxProcessor extends WorkerHost {
  private readonly logger = new Logger(SandboxProcessor.name);

  constructor(private readonly lifecycle: SandboxLifecycle) {
    super();
  }

  async process(job: Job<SandboxJobData>, token?: string): Promise<unknown> {
    if (job.name === "sweep") return this.lifecycle.sweep();

    const { portfolioId } = job.data;
    try {
      const outcome = await this.run(job.name, portfolioId);
      if (outcome === "busy") {
        // Another operation holds this sandbox. Waiting for it is not a failed attempt.
        await job.moveToDelayed(Date.now() + BUSY_RETRY_MS, token);
        throw new DelayedError();
      }
      return outcome;
    } catch (error) {
      if (error instanceof DelayedError) throw error;
      if (error instanceof GitHubRateLimitError) {
        await job.moveToDelayed(Date.now() + error.retryAfterMs, token);
        throw new DelayedError();
      }

      const reason = errorMessage(error);
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await this.lifecycle.markFailed(portfolioId, `The preview could not start: ${reason}`);
        throw new UnrecoverableError(reason);
      }
      this.logger.warn(`Sandbox ${job.name} for ${portfolioId} attempt ${job.attemptsMade + 1} failed, will retry: ${reason}`);
      throw error;
    }
  }

  private run(name: string, portfolioId: string) {
    switch (name) {
      case "restart":
        return this.lifecycle.restart(portfolioId);
      case "rebuild":
        return this.lifecycle.rebuild(portfolioId);
      case "ensure":
        return this.lifecycle.ensure(portfolioId);
      default:
        throw new UnrecoverableError(`Unknown sandbox job: ${name}`);
    }
  }
}

/** Worker only: registers the recurring sweep with BullMQ on boot. */
@Injectable()
export class SandboxScheduler implements OnModuleInit {
  constructor(@InjectQueue(SANDBOX_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      "sandbox-sweep",
      { every: SWEEP_EVERY_MS },
      { name: "sweep", opts: { removeOnComplete: true, removeOnFail: true } },
    );
  }
}
