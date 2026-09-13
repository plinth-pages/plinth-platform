import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { DelayedError, type Job, type Queue } from "bullmq";
import { PORTFOLIO_EVENTS, type PortfolioEventPublisher } from "../events/portfolio-events";
import { PrismaService } from "../prisma/prisma.service";
import { SANDBOX_LOCKS, type SandboxLocks } from "../sandbox/sandbox-locks";
import { SandboxLifecycle } from "../sandbox/sandbox.lifecycle";
import { GitSync } from "./git-sync";
import { OperationRunner, type PushRetries } from "./operation-runner";
import {
  OPERATION_BUSY_RETRY_MS,
  OPERATIONS_QUEUE,
  PUSH_JOB_OPTIONS,
  pushJobId,
  type OperationJobData,
} from "./operations.constants";

// Operations for different portfolios run side by side; for one portfolio, the sandbox lock makes them sequential.
@Processor(OPERATIONS_QUEUE, { concurrency: 8 })
export class OperationsProcessor extends WorkerHost {
  private readonly logger = new Logger(OperationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: OperationRunner,
    private readonly lifecycle: SandboxLifecycle,
    private readonly sync: GitSync,
    @Inject(SANDBOX_LOCKS) private readonly locks: SandboxLocks,
    @Inject(PORTFOLIO_EVENTS) private readonly events: PortfolioEventPublisher,
  ) {
    super();
  }

  async process(job: Job<OperationJobData>, token?: string): Promise<unknown> {
    const { portfolioId } = job.data;
    if (job.name === "push") return this.push(job, token);

    const result = await this.locks.run(portfolioId, () => this.runner.drain(portfolioId));
    if (!result.acquired) return this.later(job, token);
    if (result.value === "drained") return "drained";

    // The sandbox isn't running: start or wake it, then come back for the queued operations.
    const outcome = await this.lifecycle.ensure(portfolioId);
    if (outcome === "busy") return this.later(job, token);
    if (outcome === "failed" || outcome === "skipped") {
      await this.failQueued(portfolioId, "The preview couldn't start, so the change wasn't applied.");
      return outcome;
    }
    return this.later(job, token, 0);
  }

  private async push(job: Job<OperationJobData>, token?: string) {
    const { portfolioId } = job.data;
    const result = await this.locks.run(portfolioId, async () => {
      const sandbox = await this.prisma.sandbox.findUnique({ where: { portfolioId } });
      if (sandbox?.pendingPush && sandbox.status === "running") await this.sync.flush(sandbox);
      return sandbox?.pendingPush ?? false;
    });
    if (!result.acquired) return this.later(job, token);
    return "pushed";
  }

  private async failQueued(portfolioId: string, error: string) {
    const queued = await this.prisma.operation.findMany({ where: { portfolioId, status: "queued" }, select: { id: true } });
    for (const { id } of queued) {
      await this.prisma.operation.update({ where: { id }, data: { status: "failed", error, finishedAt: new Date() } });
      await this.events.publish(portfolioId, { type: "operation", operationId: id, status: "failed", at: new Date().toISOString() }).catch(() => undefined);
    }
    this.logger.warn(`Failed ${queued.length} queued operation(s) for ${portfolioId}: ${error}`);
  }

  /** Waiting for the lock or the sandbox is not a failed attempt. */
  private async later(job: Job, token: string | undefined, delayMs = OPERATION_BUSY_RETRY_MS): Promise<never> {
    await job.moveToDelayed(Date.now() + Math.max(delayMs, 50), token);
    throw new DelayedError();
  }
}

/** Worker only: retries a failed push to draft through the queue. */
@Injectable()
export class QueuedPushRetries implements PushRetries {
  constructor(@InjectQueue(OPERATIONS_QUEUE) private readonly queue: Queue<OperationJobData>) {}

  async schedule(portfolioId: string): Promise<void> {
    await this.queue.add("push", { portfolioId }, { jobId: pushJobId(portfolioId), delay: 10_000, ...PUSH_JOB_OPTIONS });
  }
}
