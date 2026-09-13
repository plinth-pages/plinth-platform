import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Portfolio, Sandbox, SandboxStatus } from "@prisma/client";
import { PORTFOLIO_EVENTS, type PortfolioEventPublisher } from "../events/portfolio-events";
import { PrismaService } from "../prisma/prisma.service";
import {
  SANDBOX_DRIVER,
  SandboxBootstrapError,
  SandboxNotRunningError,
  type DestroyReason,
  type PauseReason,
  type ResumedSandbox,
  type SandboxDriver,
  type SandboxInfo,
} from "./sandbox-driver";
import { SANDBOX_LOCKS, type SandboxLocks } from "./sandbox-locks";
import {
  BOOTSTRAP_TIMEOUT_MS,
  DRAFT_BRANCH,
  MAX_CONTINUOUS_RUN_MS,
  PROVIDER_DEADLINE_SLACK_MS,
  STARTING_STALE_MS,
  SWEEP_BATCH,
  type SandboxTimings,
} from "./sandbox.constants";

/** Mints a short-lived token that can clone the organisation's repositories. */
export interface GitTokenSource {
  installationToken(): Promise<string>;
}

export const GIT_TOKENS = Symbol("GIT_TOKENS");
export const SANDBOX_LIFECYCLE_OPTIONS = Symbol("SANDBOX_LIFECYCLE_OPTIONS");

export interface SandboxLifecycleOptions {
  org: string;
  timings: SandboxTimings;
}

export type EnsureOutcome = "running" | "resumed" | "created" | "recovered" | "failed" | "skipped" | "busy";
export type SweepAction = "paused" | "rotated" | "extended" | "destroyed" | "reconciled";
export type SweepReport = Record<SweepAction | "busy", string[]>;

type PortfolioWithSandbox = Portfolio & { sandbox: Sandbox | null };

/**
 * Owns every sandbox state transition. The provider is the source of truth for whether a sandbox is running; the
 * database records what Plinth last saw and billed. Every public operation runs under the portfolio's sandbox lock
 * and re-reads the row after taking it, so concurrent jobs never act on stale state.
 *
 * Billing: a "stretch" runs from create or resume (`run_started_at`) to pause or destroy, capped at the provider's
 * deadline (`expires_at`) in case the provider paused it first. Paused time is free.
 */
@Injectable()
export class SandboxLifecycle {
  private readonly logger = new Logger(SandboxLifecycle.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SANDBOX_DRIVER) private readonly driver: SandboxDriver,
    @Inject(SANDBOX_LOCKS) private readonly locks: SandboxLocks,
    @Inject(GIT_TOKENS) private readonly tokens: GitTokenSource,
    @Inject(SANDBOX_LIFECYCLE_OPTIONS) private readonly options: SandboxLifecycleOptions,
    @Inject(PORTFOLIO_EVENTS) private readonly events: PortfolioEventPublisher,
  ) {}

  /** Makes the preview reachable: keeps a running sandbox, resumes a paused one, or builds a new one from `draft`. */
  ensure(portfolioId: string): Promise<EnsureOutcome> {
    return this.locked(portfolioId, async () => {
      const portfolio = await this.load(portfolioId);
      return portfolio ? this.ensureLoaded(portfolio) : "skipped";
    });
  }

  /** Recovery ladder for a preview that stopped answering: restart the dev server, then clear `.next`, then rebuild. */
  restart(portfolioId: string): Promise<EnsureOutcome> {
    return this.locked(portfolioId, async () => {
      const portfolio = await this.load(portfolioId);
      if (!portfolio) return "skipped";
      const sandbox = portfolio.sandbox;
      if (sandbox?.externalId && (await this.driver.info(sandbox.externalId)).state === "running") {
        return this.recover(portfolio, sandbox);
      }
      return this.ensureLoaded(portfolio);
    });
  }

  /** Throws the sandbox away and builds a fresh one. Nothing is lost: the repository is the source of truth. */
  rebuild(portfolioId: string): Promise<EnsureOutcome> {
    return this.locked(portfolioId, async () => {
      const portfolio = await this.load(portfolioId);
      if (!portfolio) return "skipped";
      if (portfolio.sandbox) await this.stop(portfolio.sandbox, "rebuild", "destroyed", null);
      return this.ensureLoaded({ ...portfolio, sandbox: await this.row(portfolio.id) });
    });
  }

  /** Called when a job has used up its attempts. Leaves nothing running behind a failed start. */
  async markFailed(portfolioId: string, message: string): Promise<void> {
    await this.locks.run(portfolioId, async () => {
      const sandbox = await this.prisma.sandbox.findUnique({ where: { portfolioId } });
      if (sandbox?.status === "starting") await this.stop(sandbox, "bootstrap_failed", "unhealthy", message);
    });
  }

  /**
   * Runs every minute: pause idle sandboxes, rotate long-running ones, destroy long-paused ones, reconcile drift.
   * `onlyPortfolioIds` limits it to those portfolios, so tests against a shared database touch only their own rows.
   */
  async sweep(now = new Date(), onlyPortfolioIds?: string[]): Promise<SweepReport> {
    const { destroyAfterPausedMs } = this.options.timings;
    const candidates = await this.prisma.sandbox.findMany({
      where: {
        ...(onlyPortfolioIds && { portfolioId: { in: onlyPortfolioIds } }),
        OR: [
          { status: "running" },
          { status: "paused", pausedAt: { lt: new Date(now.getTime() - destroyAfterPausedMs) } },
          { status: "starting", updatedAt: { lt: new Date(now.getTime() - STARTING_STALE_MS) } },
        ],
      },
      orderBy: { updatedAt: "asc" },
      take: SWEEP_BATCH,
      select: { portfolioId: true },
    });

    const report: SweepReport = { paused: [], rotated: [], extended: [], destroyed: [], reconciled: [], busy: [] };
    for (const { portfolioId } of candidates) {
      try {
        const result = await this.locks.run(portfolioId, () => this.sweepOne(portfolioId, now));
        if (!result.acquired) report.busy.push(portfolioId);
        else if (result.value) report[result.value].push(portfolioId);
      } catch (error) {
        // One provider error must not stop the sweep for everyone else.
        this.logger.warn(`Sweep failed for portfolio ${portfolioId}: ${errorMessage(error)}`);
      }
    }

    const acted = Object.entries(report).filter(([action, ids]) => action !== "extended" && ids.length);
    if (acted.length) this.logger.log(`Sweep: ${acted.map(([action, ids]) => `${action} ${ids.length}`).join(", ")}`);
    return report;
  }

  private async ensureLoaded(portfolio: PortfolioWithSandbox): Promise<EnsureOutcome> {
    if (portfolio.status !== "ready") return "skipped";
    const sandbox =
      portfolio.sandbox ??
      (await this.prisma.sandbox.upsert({ where: { portfolioId: portfolio.id }, create: { portfolioId: portfolio.id }, update: {} }));

    if (sandbox.externalId && !sandbox.trafficToken) {
      // Created before previews were made private (gate G2): its URL is public, so replace it.
      await this.stop(sandbox, "rebuild", "destroyed", null);
    } else if (sandbox.externalId) {
      const live = await this.driver.info(sandbox.externalId);
      if (live.state === "paused") return this.resume(portfolio, sandbox);
      if (live.state === "running") {
        if (sandbox.status === "starting") {
          // An earlier start was interrupted part-way; its workspace cannot be trusted.
          await this.stop(sandbox, "start_timed_out", "destroyed", null);
          return this.create(portfolio, await this.row(portfolio.id));
        }
        if ((await this.driver.health(sandbox.externalId)) === "unreachable") return this.recover(portfolio, sandbox);
        await this.markRunning(sandbox, live);
        return "running";
      }
      await this.stop(sandbox, "rebuild", "destroyed", null);
    }
    return this.create(portfolio, await this.row(portfolio.id));
  }

  private async create(portfolio: Portfolio, sandbox: Sandbox): Promise<EnsureOutcome> {
    const began = Date.now();
    await this.update(sandbox.id, { ...STOPPED, status: "starting", lastError: null });

    const gitToken = await this.tokens.installationToken();
    const created = await this.driver.create(portfolio.id, { timeoutMs: BOOTSTRAP_TIMEOUT_MS });
    // Recorded before bootstrapping, so a crash from here on cannot leak a running sandbox.
    const starting = await this.update(sandbox.id, {
      externalId: created.externalId,
      previewUrl: created.previewUrl,
      trafficToken: created.accessToken,
      runStartedAt: created.startedAt,
      expiresAt: created.expiresAt,
    });

    try {
      await this.driver.bootstrap(created.externalId, {
        cloneUrl: `https://github.com/${this.options.org}/${portfolio.repoName}.git`,
        branch: DRAFT_BRANCH,
        gitToken,
        env: {},
      });
    } catch (error) {
      await this.stop(starting, "bootstrap_failed", "unhealthy", errorMessage(error));
      // A repository that fails to install or start will fail the same way again; retrying only burns compute.
      if (error instanceof SandboxBootstrapError) return "failed";
      throw error;
    }

    const now = new Date();
    const { expiresAt } = await this.driver.extend(created.externalId, this.providerTimeoutMs(starting, now));
    await this.update(sandbox.id, { status: "running", expiresAt, coldStartMs: Date.now() - began, lastError: null });
    this.logger.log(`Preview for ${portfolio.id} started in ${Date.now() - began} ms`);
    return "created";
  }

  private async resume(portfolio: Portfolio, sandbox: Sandbox): Promise<EnsureOutcome> {
    const began = Date.now();
    const now = new Date(began);
    // If the provider paused it on its own while the row said running, bill that stretch first.
    const billed = sandbox.status === "running" ? billedSeconds(sandbox, now) : 0;

    let resumed: ResumedSandbox;
    try {
      resumed = await this.driver.resume(sandbox.externalId!, {
        timeoutMs: this.providerTimeoutMs({ lastAccessedAt: sandbox.lastAccessedAt, runStartedAt: now }, now),
      });
    } catch (error) {
      if (!(error instanceof SandboxNotRunningError)) throw error;
      await this.stop(sandbox, "rebuild", "destroyed", null);
      return this.create(portfolio, await this.row(portfolio.id));
    }

    const running = await this.update(sandbox.id, {
      status: "running",
      trafficToken: resumed.accessToken,
      runStartedAt: resumed.startedAt,
      expiresAt: resumed.expiresAt,
      pausedAt: null,
      resumeMs: Date.now() - began,
      lastError: null,
      secondsUsed: { increment: billed },
    });
    if ((await this.driver.health(sandbox.externalId!)) === "unreachable") return this.recover(portfolio, running);
    return "resumed";
  }

  private async recover(portfolio: Portfolio, sandbox: Sandbox): Promise<EnsureOutcome> {
    const externalId = sandbox.externalId!;
    await this.update(sandbox.id, { status: "starting", lastError: null });

    for (const clearCache of [false, true]) {
      try {
        await this.driver.restartDevServer(externalId, { clearCache });
        await this.update(sandbox.id, { status: "running" });
        return "recovered";
      } catch (error) {
        if (error instanceof SandboxNotRunningError) break;
        this.logger.warn(`Restarting the dev server for ${portfolio.id} (clearCache=${clearCache}) failed: ${errorMessage(error)}`);
      }
    }

    await this.stop(await this.row(portfolio.id), "unrecoverable", "destroyed", null);
    return this.create(portfolio, await this.row(portfolio.id));
  }

  private async sweepOne(portfolioId: string, now: Date): Promise<SweepAction | null> {
    const sandbox = await this.prisma.sandbox.findUnique({ where: { portfolioId } });
    if (!sandbox) return null;
    const { idlePauseMs, destroyAfterPausedMs, rotateAfterMs } = this.options.timings;

    if (sandbox.status === "starting") {
      if (now.getTime() - sandbox.updatedAt.getTime() < STARTING_STALE_MS) return null;
      await this.stop(sandbox, "start_timed_out", "unhealthy", "Starting the preview took too long. Try again.");
      return "destroyed";
    }
    if (sandbox.status === "paused") {
      if (!sandbox.pausedAt || now.getTime() - sandbox.pausedAt.getTime() < destroyAfterPausedMs) return null;
      await this.stop(sandbox, "idle_too_long", "destroyed", null);
      return "destroyed";
    }
    if (sandbox.status !== "running" || !sandbox.externalId) return null;

    const live = await this.driver.info(sandbox.externalId);
    if (live.state === "gone") {
      await this.stop(sandbox, "rebuild", "destroyed", null);
      return "reconciled";
    }
    if (live.state === "paused") {
      const pausedAt = new Date(Math.min(now.getTime(), sandbox.expiresAt?.getTime() ?? now.getTime()));
      await this.update(sandbox.id, { ...PAUSED(pausedAt), secondsUsed: { increment: billedSeconds(sandbox, now) } });
      return "reconciled";
    }

    const lastActive = sandbox.lastAccessedAt ?? sandbox.runStartedAt ?? now;
    if (now.getTime() - lastActive.getTime() >= idlePauseMs) {
      await this.pause(sandbox, "idle", now);
      return "paused";
    }
    if (sandbox.runStartedAt && now.getTime() - sandbox.runStartedAt.getTime() >= rotateAfterMs) {
      await this.rotate(sandbox, now);
      return "rotated";
    }
    const { expiresAt } = await this.driver.extend(sandbox.externalId, this.providerTimeoutMs(sandbox, now));
    await this.update(sandbox.id, { expiresAt });
    return "extended";
  }

  private async pause(sandbox: Sandbox, reason: PauseReason, now: Date) {
    await this.driver.pause(sandbox.externalId!, reason);
    return this.update(sandbox.id, { ...PAUSED(now), secondsUsed: { increment: billedSeconds(sandbox, now) } });
  }

  /** Pause and immediately resume, which resets the provider's continuous-runtime clock. */
  private async rotate(sandbox: Sandbox, now: Date) {
    const began = Date.now();
    const paused = await this.pause(sandbox, "rotation", now);
    const resumed = await this.driver.resume(sandbox.externalId!, {
      timeoutMs: this.providerTimeoutMs({ lastAccessedAt: paused.lastAccessedAt, runStartedAt: now }, now),
    });
    await this.update(sandbox.id, {
      status: "running",
      trafficToken: resumed.accessToken,
      runStartedAt: resumed.startedAt,
      expiresAt: resumed.expiresAt,
      pausedAt: null,
      resumeMs: Date.now() - began,
    });
  }

  /** Destroys the provider sandbox (if any), bills the open stretch and leaves the row with nothing live. */
  private async stop(sandbox: Sandbox, reason: DestroyReason, status: "destroyed" | "unhealthy", lastError: string | null) {
    if (sandbox.externalId) await this.driver.destroy(sandbox.externalId, reason);
    await this.update(sandbox.id, {
      ...STOPPED,
      status,
      lastError,
      secondsUsed: { increment: billedSeconds(sandbox, new Date()) },
    });
  }

  private async markRunning(sandbox: Sandbox, live: SandboxInfo) {
    if (sandbox.status === "running" && !sandbox.lastError) return;
    await this.update(sandbox.id, {
      status: "running",
      runStartedAt: sandbox.runStartedAt ?? live.startedAt ?? new Date(),
      expiresAt: live.expiresAt,
      pausedAt: null,
      lastError: null,
    });
  }

  /**
   * The provider's pause deadline: shortly after Plinth's own idle pause would happen, and never past the
   * continuous-runtime cap.
   */
  private providerTimeoutMs(sandbox: Pick<Sandbox, "lastAccessedAt" | "runStartedAt">, now: Date): number {
    const idleDeadline = (sandbox.lastAccessedAt ?? now).getTime() + this.options.timings.idlePauseMs + PROVIDER_DEADLINE_SLACK_MS;
    const runDeadline = (sandbox.runStartedAt ?? now).getTime() + MAX_CONTINUOUS_RUN_MS;
    return Math.max(60_000, Math.min(idleDeadline, runDeadline) - now.getTime());
  }

  private async locked(portfolioId: string, operation: () => Promise<EnsureOutcome>): Promise<EnsureOutcome> {
    const result = await this.locks.run(portfolioId, operation);
    return result.acquired ? result.value : "busy";
  }

  private load(portfolioId: string): Promise<PortfolioWithSandbox | null> {
    return this.prisma.portfolio.findUnique({ where: { id: portfolioId }, include: { sandbox: true } });
  }

  private async row(portfolioId: string): Promise<Sandbox> {
    return this.prisma.sandbox.findUniqueOrThrow({ where: { portfolioId } });
  }

  private async update(id: string, data: Parameters<PrismaService["sandbox"]["update"]>[0]["data"]): Promise<Sandbox> {
    const sandbox = await this.prisma.sandbox.update({ where: { id }, data });
    if (data.status) {
      await this.events
        .publish(sandbox.portfolioId, { type: "sandbox", status: sandbox.status, at: new Date().toISOString() })
        .catch((error: unknown) => this.logger.warn(`Could not publish a sandbox event: ${errorMessage(error)}`));
    }
    return sandbox;
  }
}

const STOPPED = { externalId: null, previewUrl: null, trafficToken: null, runStartedAt: null, expiresAt: null, pausedAt: null };
const PAUSED = (pausedAt: Date) => ({ status: "paused" as SandboxStatus, pausedAt, runStartedAt: null, expiresAt: null });

/** Seconds of the open stretch, ending at `endedAt` or the provider's deadline, whichever came first. */
export function billedSeconds(sandbox: Pick<Sandbox, "runStartedAt" | "expiresAt">, endedAt: Date): number {
  if (!sandbox.runStartedAt) return 0;
  const end = Math.min(endedAt.getTime(), sandbox.expiresAt?.getTime() ?? Infinity);
  return Math.max(0, Math.round((end - sandbox.runStartedAt.getTime()) / 1000));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
