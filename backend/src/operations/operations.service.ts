import { InjectQueue } from "@nestjs/bullmq";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Operation, User } from "@prisma/client";
import type { OperationFailure, OperationSummary, OperationTimings } from "@plinth-pages/shared";
import type { Queue } from "bullmq";
import { PORTFOLIO_EVENTS, type PortfolioEventPublisher } from "../events/portfolio-events";
import { PrismaService } from "../prisma/prisma.service";
import { defaultSummary, editInputSchema } from "./edit-input";
import { FINISHED, OPERATION_JOB_OPTIONS, OPERATIONS_QUEUE, operationJobId, type OperationJobData } from "./operations.constants";

const TIMING_SAMPLE = 50;

/** Api side: records operations and queues them. The worker runs them through the safety net. */
@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(OPERATIONS_QUEUE) private readonly queue: Queue<OperationJobData>,
    @Inject(PORTFOLIO_EVENTS) private readonly events: PortfolioEventPublisher,
  ) {}

  async submitEdit(user: User, portfolioId: string, body: unknown): Promise<OperationSummary> {
    const portfolio = await this.prisma.portfolio.findFirst({ where: { id: portfolioId, userId: user.id } });
    if (!portfolio) throw new NotFoundException("Portfolio not found");
    if (portfolio.status !== "ready") throw new ConflictException("The portfolio's repository isn't ready yet.");

    const parsed = editInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "));
    }

    const operation = await this.prisma.operation.create({
      data: { portfolioId, type: "edit", actor: "user", summary: defaultSummary(parsed.data), input: parsed.data },
    });
    // A change counts as activity: the sandbox must not idle-pause while it waits in the queue.
    await this.prisma.sandbox.upsert({
      where: { portfolioId },
      create: { portfolioId, lastAccessedAt: new Date() },
      update: { lastAccessedAt: new Date() },
    });
    await this.queue.add("run", { portfolioId, operationId: operation.id }, { jobId: operationJobId(operation.id), ...OPERATION_JOB_OPTIONS });
    await this.events
      .publish(portfolioId, { type: "operation", operationId: operation.id, status: "queued", at: new Date().toISOString() })
      .catch(() => undefined);
    return toSummary(operation);
  }

  /** Queues a publish, or returns the one already queued or running — pressing Publish twice publishes once. */
  async submitPublish(user: User, portfolioId: string): Promise<OperationSummary> {
    const portfolio = await this.prisma.portfolio.findFirst({ where: { id: portfolioId, userId: user.id } });
    if (!portfolio) throw new NotFoundException("Portfolio not found");
    if (portfolio.status !== "ready") throw new ConflictException("The portfolio's repository isn't ready yet.");

    const existing = await this.prisma.operation.findFirst({
      where: { portfolioId, type: "publish", status: { in: ["queued", "staging", "checking", "applying"] } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return toSummary(existing);

    const operation = await this.prisma.operation.create({
      data: { portfolioId, type: "publish", actor: "user", summary: "Publish", input: {} },
    });
    await this.prisma.sandbox.upsert({
      where: { portfolioId },
      create: { portfolioId, lastAccessedAt: new Date() },
      update: { lastAccessedAt: new Date() },
    });
    await this.queue.add("run", { portfolioId, operationId: operation.id }, { jobId: operationJobId(operation.id), ...OPERATION_JOB_OPTIONS });
    await this.events
      .publish(portfolioId, { type: "operation", operationId: operation.id, status: "queued", at: new Date().toISOString() })
      .catch(() => undefined);
    return toSummary(operation);
  }

  async list(user: User, portfolioId: string, limit = 20): Promise<{ operations: OperationSummary[]; timings: OperationTimings }> {
    await this.owned(user, portfolioId);
    const [operations, timed] = await Promise.all([
      this.prisma.operation.findMany({ where: { portfolioId }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 100) }),
      this.prisma.operation.findMany({
        // Edits only: a publish runs a full production build and would swamp the edit-check budget.
        where: { portfolioId, type: "edit", status: { in: FINISHED }, checkMs: { not: null } },
        orderBy: { createdAt: "desc" },
        take: TIMING_SAMPLE,
        select: { checkMs: true, totalMs: true },
      }),
    ]);
    return { operations: operations.map(toSummary), timings: timings(timed) };
  }

  async get(user: User, portfolioId: string, operationId: string): Promise<OperationSummary> {
    await this.owned(user, portfolioId);
    const operation = await this.prisma.operation.findFirst({ where: { id: operationId, portfolioId } });
    if (!operation) throw new NotFoundException("Operation not found");
    return toSummary(operation);
  }

  private async owned(user: User, portfolioId: string) {
    const portfolio = await this.prisma.portfolio.findFirst({ where: { id: portfolioId, userId: user.id }, select: { id: true } });
    if (!portfolio) throw new NotFoundException("Portfolio not found");
  }
}

export function toSummary(operation: Operation): OperationSummary {
  return {
    id: operation.id,
    type: operation.type,
    actor: operation.actor,
    status: operation.status,
    summary: operation.summary,
    diff: operation.diff,
    failures: (operation.checkOutput as OperationFailure[] | null) ?? [],
    error: operation.error,
    commitSha: operation.commitSha,
    revertSha: operation.revertSha,
    checkMs: operation.checkMs,
    totalMs: operation.totalMs,
    createdAt: operation.createdAt.toISOString(),
    startedAt: operation.startedAt?.toISOString() ?? null,
    finishedAt: operation.finishedAt?.toISOString() ?? null,
  };
}

export function timings(rows: { checkMs: number | null; totalMs: number | null }[]): OperationTimings {
  const check = rows.map((r) => r.checkMs).filter((v): v is number => v !== null);
  const total = rows.map((r) => r.totalMs).filter((v): v is number => v !== null);
  return {
    checkP50Ms: percentile(check, 50),
    checkP95Ms: percentile(check, 95),
    totalP50Ms: percentile(total, 50),
    totalP95Ms: percentile(total, 95),
    sampleSize: check.length,
  };
}

/** Nearest-rank percentile. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}
