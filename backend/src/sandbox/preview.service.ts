import { InjectQueue } from "@nestjs/bullmq";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Portfolio, Sandbox, User } from "@prisma/client";
import type { PreviewSummary } from "@plinth-pages/shared";
import type { Queue } from "bullmq";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { SANDBOX_JOB_OPTIONS, SANDBOX_QUEUE, sandboxJobId, type SandboxJobData, type SandboxJobName } from "./sandbox.constants";

const LIVE_JOB_STATES = new Set(["waiting", "active", "delayed", "prioritized", "waiting-children"]);

/**
 * The api side of previews: records visits and queues work for the worker. It never talks to E2B — a paused sandbox
 * is woken by queueing `ensure`, which the worker resumes in about a second.
 */
@Injectable()
export class PreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue(SANDBOX_QUEUE) private readonly queue: Queue<SandboxJobData>,
  ) {}

  async status(user: User, portfolioId: string): Promise<PreviewSummary> {
    const portfolio = await this.owned(user, portfolioId);
    return this.summary(portfolio.id, await this.prisma.sandbox.findUnique({ where: { portfolioId } }));
  }

  /**
   * Opening the IDE and its heartbeat both land here. Refreshes the idle clock, and wakes or builds the sandbox unless
   * it is already running with time left on the provider's deadline.
   */
  async open(user: User, portfolioId: string): Promise<PreviewSummary> {
    const portfolio = await this.ready(user, portfolioId);
    const now = new Date();
    const sandbox = await this.prisma.sandbox.upsert({
      where: { portfolioId: portfolio.id },
      create: { portfolioId: portfolio.id, lastAccessedAt: now },
      update: { lastAccessedAt: now },
    });

    // Past its deadline, the provider may have paused it before the sweep noticed. Queueing while a job for this
    // portfolio is already queued or running is a no-op, so a `starting` row abandoned by a crashed worker recovers too.
    const live = sandbox.status === "running" && (!sandbox.expiresAt || sandbox.expiresAt > now);
    if (!live) await this.enqueue("ensure", portfolio.id);
    return this.summary(portfolio.id, sandbox);
  }

  async restart(user: User, portfolioId: string): Promise<PreviewSummary> {
    const portfolio = await this.ready(user, portfolioId);
    await this.touch(portfolio.id);
    await this.enqueue("restart", portfolio.id);
    return this.summary(portfolio.id, await this.prisma.sandbox.findUnique({ where: { portfolioId } }));
  }

  async rebuild(user: User, portfolioId: string): Promise<PreviewSummary> {
    const portfolio = await this.ready(user, portfolioId);
    await this.touch(portfolio.id);
    await this.enqueue("rebuild", portfolio.id);
    return this.summary(portfolio.id, await this.prisma.sandbox.findUnique({ where: { portfolioId } }));
  }

  private async summary(portfolioId: string, sandbox: Sandbox | null): Promise<PreviewSummary> {
    const idlePauseSeconds = this.config.get("SANDBOX_IDLE_PAUSE_MINUTES", { infer: true }) * 60;
    const pending = await this.hasLiveJob(portfolioId);
    if (!sandbox) {
      return {
        status: "none",
        previewUrl: null,
        pending,
        lastError: null,
        lastAccessedAt: null,
        runStartedAt: null,
        secondsUsed: 0,
        coldStartMs: null,
        resumeMs: null,
        idlePauseSeconds,
      };
    }
    return {
      status: sandbox.status,
      previewUrl: sandbox.previewUrl,
      pending,
      lastError: sandbox.lastError,
      lastAccessedAt: sandbox.lastAccessedAt?.toISOString() ?? null,
      runStartedAt: sandbox.runStartedAt?.toISOString() ?? null,
      secondsUsed: sandbox.secondsUsed,
      coldStartMs: sandbox.coldStartMs,
      resumeMs: sandbox.resumeMs,
      idlePauseSeconds,
    };
  }

  private async hasLiveJob(portfolioId: string): Promise<boolean> {
    const names: SandboxJobName[] = ["ensure", "restart", "rebuild"];
    const states = await Promise.all(
      names.map(async (name) => (await this.queue.getJob(sandboxJobId(name, portfolioId)))?.getState() ?? "missing"),
    );
    return states.some((state) => LIVE_JOB_STATES.has(state));
  }

  private enqueue(name: SandboxJobName, portfolioId: string) {
    return this.queue.add(name, { portfolioId }, { jobId: sandboxJobId(name, portfolioId), ...SANDBOX_JOB_OPTIONS });
  }

  private touch(portfolioId: string) {
    return this.prisma.sandbox.upsert({
      where: { portfolioId },
      create: { portfolioId, lastAccessedAt: new Date() },
      update: { lastAccessedAt: new Date() },
    });
  }

  private async owned(user: User, portfolioId: string): Promise<Portfolio> {
    const portfolio = await this.prisma.portfolio.findFirst({ where: { id: portfolioId, userId: user.id } });
    if (!portfolio) throw new NotFoundException("Portfolio not found");
    return portfolio;
  }

  private async ready(user: User, portfolioId: string): Promise<Portfolio> {
    const portfolio = await this.owned(user, portfolioId);
    if (portfolio.status !== "ready") {
      throw new ConflictException("The preview is available once the portfolio's repository has been created.");
    }
    return portfolio;
  }
}
