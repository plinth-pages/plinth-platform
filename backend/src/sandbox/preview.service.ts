import { InjectQueue } from "@nestjs/bullmq";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Portfolio, Sandbox, User } from "@prisma/client";
import type { PreviewSummary } from "@plinth-pages/shared";
import type { Queue } from "bullmq";
import type { Env } from "../config/env";
import { PREVIEW_SESSIONS, PREVIEW_URLS } from "../preview/preview.providers";
import type { PreviewSessions, PreviewUrls } from "../preview/preview-sessions";
import { PrismaService } from "../prisma/prisma.service";
import { SANDBOX_QUEUE, enqueueSandboxJob, sandboxJobId, type SandboxJobData, type SandboxJobName } from "./sandbox.constants";

const LIVE_JOB_STATES = new Set(["waiting", "active", "delayed", "prioritized", "waiting-children"]);

/**
 * The api side of previews: records visits, issues preview links and queues work for the worker. It never talks to
 * E2B — a paused sandbox is woken by queueing `ensure`, which the worker resumes in about a second.
 */
@Injectable()
export class PreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue(SANDBOX_QUEUE) private readonly queue: Queue<SandboxJobData>,
    @Inject(PREVIEW_SESSIONS) private readonly sessions: PreviewSessions,
    @Inject(PREVIEW_URLS) private readonly urls: PreviewUrls,
  ) {}

  async status(user: User, portfolioId: string): Promise<PreviewSummary> {
    const portfolio = await this.owned(user, portfolioId);
    const label = await this.sessions.current(portfolio.id, user.id);
    return this.summary(portfolio.id, await this.row(portfolio.id), label);
  }

  /**
   * Opening the IDE and its heartbeat both land here. Refreshes the idle clock and the preview link, and wakes or
   * builds the sandbox unless it is already running with time left on the provider's deadline.
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
    const live = sandbox.status === "running" && Boolean(sandbox.trafficToken) && (!sandbox.expiresAt || sandbox.expiresAt > now);
    if (!live) await enqueueSandboxJob(this.queue, "ensure", portfolio.id);
    return this.summary(portfolio.id, sandbox, await this.sessions.open(portfolio.id, user.id));
  }

  async restart(user: User, portfolioId: string): Promise<PreviewSummary> {
    return this.queueAndSummarize(user, portfolioId, "restart");
  }

  async rebuild(user: User, portfolioId: string): Promise<PreviewSummary> {
    return this.queueAndSummarize(user, portfolioId, "rebuild");
  }

  private async queueAndSummarize(user: User, portfolioId: string, name: SandboxJobName) {
    const portfolio = await this.ready(user, portfolioId);
    const sandbox = await this.prisma.sandbox.upsert({
      where: { portfolioId },
      create: { portfolioId, lastAccessedAt: new Date() },
      update: { lastAccessedAt: new Date() },
    });
    await enqueueSandboxJob(this.queue, name, portfolio.id);
    return this.summary(portfolio.id, sandbox, await this.sessions.open(portfolio.id, user.id));
  }

  private async summary(portfolioId: string, sandbox: Sandbox | null, label: string | null): Promise<PreviewSummary> {
    const idlePauseSeconds = this.config.get("SANDBOX_IDLE_PAUSE_MINUTES", { infer: true }) * 60;
    const pending = await this.hasLiveJob(portfolioId);
    // The sandbox's own URL is never sent to a browser; it only works with the access token.
    const previewUrl = label ? this.urls.url(label) : null;
    if (!sandbox) {
      return {
        status: "none",
        previewUrl,
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
      previewUrl,
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

  private row(portfolioId: string) {
    return this.prisma.sandbox.findUnique({ where: { portfolioId } });
  }

  async owned(user: User, portfolioId: string): Promise<Portfolio> {
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
