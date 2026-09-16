import { InjectQueue, Processor } from "@nestjs/bullmq";
import { LoggedWorkerHost, WORKER_DEFAULTS } from "../queue/logged-worker-host";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { CredentialSync } from "../credentials/credential-sync";
import { DelayedError, type Job, type Queue } from "bullmq";
import { PORTFOLIO_EVENTS, type PortfolioEventPublisher } from "../events/portfolio-events";
import { DeploymentTracker, TRACK_POLL_MS } from "../hosting/hosting";
import { PrismaService } from "../prisma/prisma.service";
import { SANDBOX_LOCKS, type SandboxLocks } from "../sandbox/sandbox-locks";
import { SandboxLifecycle } from "../sandbox/sandbox.lifecycle";
import { GitSync } from "./git-sync";
import type { Prisma } from "@prisma/client";
import type { FollowUp } from "./integration-planner";
import { OperationRunner, type DeploymentTracking, type FollowUpQueue, type PushRetries } from "./operation-runner";
import {
  OPERATION_BUSY_RETRY_MS,
  OPERATION_JOB_OPTIONS,
  operationJobId,
  OPERATIONS_QUEUE,
  PUSH_JOB_OPTIONS,
  TRACK_DEPLOYMENT_JOB_OPTIONS,
  pushJobId,
  trackDeploymentJobId,
  type OperationJobData,
} from "./operations.constants";

// Operations for different portfolios run side by side; for one portfolio, the sandbox lock makes them sequential.
@Processor(OPERATIONS_QUEUE, { ...WORKER_DEFAULTS, concurrency: 8 })
export class OperationsProcessor extends LoggedWorkerHost {
  protected override readonly logStarts = true;
  private readonly logger = new Logger(OperationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: OperationRunner,
    private readonly lifecycle: SandboxLifecycle,
    private readonly sync: GitSync,
    @Inject(SANDBOX_LOCKS) private readonly locks: SandboxLocks,
    @Inject(PORTFOLIO_EVENTS) private readonly events: PortfolioEventPublisher,
    private readonly tracker: DeploymentTracker,
    @Optional() @Inject(CredentialSync) private readonly credentials: CredentialSync | null = null,
  ) {
    super();
  }

  async process(job: Job<OperationJobData>, token?: string): Promise<unknown> {
    const { portfolioId } = job.data;
    if (job.name === "push") return this.push(job, token);
    if (job.name === "track-deployment") return this.trackDeployment(job, token);
    if (job.name === "sync-credentials") return this.syncCredentials(job, token);

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

  /** Holds the portfolio lock so `.env.local` is never rewritten while a sandbox is being created or destroyed. */
  private async syncCredentials(job: Job<OperationJobData>, token?: string) {
    if (!this.credentials) return "skipped";
    const result = await this.locks.run(job.data.portfolioId, () => this.credentials!.sync(job.data.portfolioId));
    if (!result.acquired) return this.later(job, token);
    return result.value;
  }

  /** Needs no lock: it only reads the host and writes the deployment row. */
  private async trackDeployment(job: Job<OperationJobData>, token?: string) {
    const deploymentId = job.data.deploymentId!;
    try {
      if ((await this.tracker.track(deploymentId)) === "wait") return this.later(job, token, TRACK_POLL_MS);
      return "tracked";
    } catch (error) {
      if (error instanceof DelayedError) throw error;
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await this.tracker.giveUp(deploymentId, error instanceof Error ? error.message : String(error));
      }
      throw error;
    }
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

/** Worker only: follows deployments through the queue. */
@Injectable()
export class QueuedDeploymentTracking implements DeploymentTracking {
  constructor(@InjectQueue(OPERATIONS_QUEUE) private readonly queue: Queue<OperationJobData>) {}

  async track(portfolioId: string, deploymentId: string): Promise<void> {
    await this.queue.add("track-deployment", { portfolioId, deploymentId }, { jobId: trackDeploymentJobId(deploymentId), delay: 5_000, ...TRACK_DEPLOYMENT_JOB_OPTIONS });
  }
}

/** Worker only: records and queues operations a finished operation asked for. They run after it, in order. */
@Injectable()
export class QueuedFollowUps implements FollowUpQueue {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(OPERATIONS_QUEUE) private readonly queue: Queue<OperationJobData>,
    @Inject(PORTFOLIO_EVENTS) private readonly events: PortfolioEventPublisher,
  ) {}

  async enqueue(portfolioId: string, followUps: FollowUp[]): Promise<void> {
    for (const followUp of followUps) {
      const operation = await this.prisma.operation.create({
        data: { portfolioId, type: followUp.type, actor: "copilot", summary: followUp.summary, input: followUp.input as Prisma.InputJsonValue },
      });
      await this.queue.add("run", { portfolioId, operationId: operation.id }, { jobId: operationJobId(operation.id), ...OPERATION_JOB_OPTIONS });
      await this.events.publish(portfolioId, { type: "operation", operationId: operation.id, status: "queued", at: new Date().toISOString() }).catch(() => undefined);
    }
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
