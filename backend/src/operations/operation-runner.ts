import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { Operation, OperationStatus, Prisma, Sandbox } from "@prisma/client";
import type { OperationFailure, OperationStep } from "@plinth-pages/shared";
import { posix } from "path";
import { PORTFOLIO_EVENTS, type PortfolioEventPublisher } from "../events/portfolio-events";
import { HOSTING, HostingError, type Hosting } from "../hosting/hosting";
import { PrismaService } from "../prisma/prisma.service";
import { gitAuthEnv } from "../sandbox/e2b.driver";
import { GIT_TOKENS, type GitTokenSource } from "../sandbox/git-tokens";
import { SANDBOX_DRIVER, SandboxNotRunningError, type ExecResult, type SandboxDriver, type WorkspaceRoot } from "../sandbox/sandbox-driver";
import { SANDBOX_WAKER, type SandboxWaker } from "../sandbox/sandbox-waker";
import { parseBuildOutput, parsePlinthCheck, parseTscOutput, reported, sections } from "./check-output";
import { CopilotPlanner, copilotInputSchema, parseContext } from "../copilot/copilot-planner";
import { CONTEXT_DIRECTORIES, MAX_CONTEXT_BYTES } from "../copilot/copilot-plan";
import { clip, requestKey } from "../copilot/copilot-alerts";
import { Alerts } from "../observability/alerts";
import { commitSubject, editInputSchema } from "./edit-input";
import { OperationAborted } from "./operation-errors";
import { SECRET_ENVIRONMENT, type SecretEnvironment } from "../credentials/credential-sync";
import { renderEnvFile } from "../sandbox/e2b.driver";
import { IntegrationPlanner, installInputSchema, moveInputSchema, uninstallInputSchema, type FileChange, type FollowUp, type Plan } from "./integration-planner";
import {
  EXIT,
  OPERATION_BRANCH_PREFIX,
  affectedRoutes,
  applyScript,
  buildScript,
  checkScript,
  discardScript,
  findOperationCommitScript,
  healthScript,
  nulList,
  prepareFilesScript,
  prepareScript,
  publishPushScript,
  publishStatusScript,
  revertScript,
  contextScript,
  stageScript,
  vendorScript,
} from "./git-scripts";
import { GitSync, PushFailedError } from "./git-sync";
import { IN_PROGRESS } from "./operations.constants";

export const PUSH_RETRIES = Symbol("PUSH_RETRIES");

/** Schedules a retry of a failed push to draft. */
export interface PushRetries {
  schedule(portfolioId: string): Promise<void>;
}

export const DEPLOYMENT_TRACKING = Symbol("DEPLOYMENT_TRACKING");

/** Starts following a deployment on the host, in the background. */
export interface DeploymentTracking {
  track(portfolioId: string, deploymentId: string): Promise<void>;
}

export type DrainOutcome = "drained" | "sandbox_not_running";

/** Queues operations a finished operation asked for — e.g. an integration install requested through the co-pilot. */
export const FOLLOW_UPS = Symbol("FOLLOW_UPS");
export interface FollowUpQueue {
  enqueue(portfolioId: string, followUps: FollowUp[]): Promise<void>;
}


const STEP_TIMEOUT = { short: 60_000, prepare: 6 * 60_000, check: 3 * 60_000, apply: 6 * 60_000, health: 4 * 60_000, build: 8 * 60_000 };

/**
 * The safety net (Phase 5). Runs a portfolio's queued operations one at a time, oldest first:
 *
 *   stage (worktree) → mutate → install/format → plinth check + tsc → apply (commit, fast-forward live) → push → health
 *
 * Nothing reaches the live tree — and so the preview — until both checks pass. A change that passes but breaks
 * rendering is undone with a revert commit. Must be called while holding the portfolio's sandbox lock.
 */
@Injectable()
export class OperationRunner {
  private readonly logger = new Logger(OperationRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SANDBOX_DRIVER) private readonly driver: SandboxDriver,
    @Inject(GIT_TOKENS) private readonly git: GitTokenSource,
    private readonly sync: GitSync,
    @Inject(PORTFOLIO_EVENTS) private readonly events: PortfolioEventPublisher,
    @Inject(PUSH_RETRIES) private readonly pushRetries: PushRetries,
    @Inject(SANDBOX_WAKER) private readonly waker: SandboxWaker,
    @Inject(HOSTING) private readonly hosting: Hosting,
    @Inject(DEPLOYMENT_TRACKING) private readonly tracking: DeploymentTracking,
    private readonly integrations: IntegrationPlanner,
    private readonly copilot: CopilotPlanner,
    @Inject(FOLLOW_UPS) private readonly followUps: FollowUpQueue,
    @Optional() @Inject(SECRET_ENVIRONMENT) private readonly secrets: SecretEnvironment | null = null,
    @Optional() private readonly alerts?: Alerts,
  ) {}

  async drain(portfolioId: string): Promise<DrainOutcome> {
    const sandbox = await this.prisma.sandbox.findUnique({ where: { portfolioId } });
    if (sandbox?.status !== "running" || !sandbox.externalId) return "sandbox_not_running";

    await this.recoverInterrupted(sandbox);
    for (;;) {
      const operation = await this.prisma.operation.findFirst({
        where: { portfolioId, status: "queued" },
        orderBy: { createdAt: "asc" },
      });
      if (!operation) return "drained";
      const current = await this.prisma.sandbox.findUniqueOrThrow({ where: { portfolioId } });
      if (current.status !== "running" || !current.externalId) return "sandbox_not_running";
      await this.run(operation, current);
    }
  }

  private async run(operation: Operation, sandbox: Sandbox): Promise<void> {
    if (operation.type === "publish") return this.publish(operation, sandbox);
    const began = Date.now();
    const externalId = sandbox.externalId!;
    const branch = `${OPERATION_BRANCH_PREFIX}${operation.id}`;
    let committed: string | null = null;
    await this.transition(operation, "staging", { startedAt: new Date(), attempts: { increment: 1 } });

    try {
      this.validateInput(operation);

      // 0–1. Precondition and stage. An unpushed commit from an earlier operation is pushed first.
      let stage = await this.exec(externalId, "live", stageScript(), { PLINTH_BRANCH: branch }, STEP_TIMEOUT.short);
      if (stage.exitCode === EXIT.ahead) {
        await this.sync.push(sandbox);
        stage = await this.exec(externalId, "live", stageScript(), { PLINTH_BRANCH: branch }, STEP_TIMEOUT.short);
      }
      if (stage.exitCode === EXIT.dirty) {
        throw new OperationAborted("The workspace has changes Plinth didn't make, so nothing was applied. Rebuild the preview to reset it.");
      }
      if (stage.exitCode === EXIT.diverged) {
        throw new OperationAborted("The draft branch changed outside Plinth, so nothing was applied. Rebuild the preview to pick up the changes.");
      }
      this.expectSuccess(stage, "Preparing a workspace for the change");

      // 3. Mutate, in the staging worktree only. Integrations are planned from the staged files by the codemod engine.
      this.progress(operation, "reading");
      const plan = await this.planChange(operation, externalId);
      if (plan.kind === "noop") {
        await this.discard(externalId);
        await this.finish(operation, "applied", began, { diff: plan.message });
        await this.queueFollowUps(operation, plan.followUps);
        return;
      }
      if (plan.kind === "reject") return this.reject(operation, externalId, began, plan.failures, null);
      if (plan.tarball) {
        const vendored = await this.exec(externalId, "staging", vendorScript(), { PLINTH_PATH: plan.tarball.path, PLINTH_B64: plan.tarball.base64 }, STEP_TIMEOUT.short);
        this.expectSuccess(vendored, "Adding the package");
      }
      this.progress(operation, "writing");
      await this.mutate(externalId, plan.files);

      // 2 and 4. Dependencies and formatting.
      this.progress(operation, "preparing");
      const prepared = await this.exec(externalId, "staging", prepareScript(), {}, STEP_TIMEOUT.prepare);
      if (prepared.exitCode === EXIT.noChanges) {
        await this.discard(externalId);
        await this.finish(operation, "applied", began, { diff: "No changes: the files already had this content." });
        await this.queueFollowUps(operation, plan.followUps);
        return;
      }
      if (prepared.exitCode === EXIT.installFailed || prepared.exitCode === EXIT.formatFailed) {
        const source = prepared.exitCode === EXIT.installFailed ? "install" : "format";
        const detail = sections(prepared.stdout)[source] ?? prepared.stderr;
        return this.reject(operation, externalId, began, [{ source, message: detail.trim() || `${source} failed` }], null);
      }
      this.expectSuccess(prepared, "Formatting the change");
      let depsChanged = reported(prepared.stdout, "DEPS") === "1";
      let diffStat = sections(prepared.stdout).stat ?? null;

      // 5–6. plinth check and tsc, in parallel.
      await this.transition(operation, "checking");
      this.progress(operation, "checking");
      let { failures, checkMs } = await this.check(externalId);

      // 7. Repair: one more pass when the checks caught a slip rather than a bad idea. The worktree still holds the
      // failed edits, so the model sees the errors against the files as they actually stand.
      if (failures.length && operation.type === "copilot") {
        this.progress(operation, "repairing");
        const repaired = await this.copilot.repair(operation, failures, plan.files.map((file) => file.path), () => this.readStagedContext(externalId));
        if (repaired) {
          // Still staging: nothing has touched the live tree, and the UI should not say "publishing".
          await this.transition(operation, "staging");
          await this.mutate(externalId, repaired);
          const again = await this.exec(externalId, "staging", prepareScript(), {}, STEP_TIMEOUT.prepare);
          if (again.exitCode === EXIT.installFailed || again.exitCode === EXIT.formatFailed) {
            // The repair broke something the first pass hadn't: report what the checks originally refused.
            return this.reject(operation, externalId, began, failures, checkMs, diffStat);
          }
          this.expectSuccess(again, "Formatting the fix");
          depsChanged = depsChanged || reported(again.stdout, "DEPS") === "1";
          diffStat = sections(again.stdout).stat ?? diffStat;
          await this.transition(operation, "checking");
          const rechecked = await this.check(externalId);
          this.logger.log(`Repair for ${operation.id} ${rechecked.failures.length ? "did not hold" : "fixed the change"}`);
          failures = rechecked.failures;
          checkMs = rechecked.checkMs ?? checkMs;
        }
      }
      if (failures.length) return this.reject(operation, externalId, began, failures, checkMs, diffStat);

      // 8. Apply: commit in the worktree, fast-forward the live tree. From here the preview sees the change.
      await this.transition(operation, "applying", { checkMs, diff: diffStat });
      this.progress(operation, "applying");
      const identity = await this.git.botIdentity();
      const subject = commitSubject(operation.summary);
      const applied = await this.exec(
        externalId,
        "live",
        applyScript(),
        {
          ...authorEnv(identity),
          PLINTH_BRANCH: branch,
          PLINTH_SUBJECT: subject,
          PLINTH_OPERATION_ID: operation.id,
          PLINTH_DEPS: depsChanged ? "1" : "0",
        },
        STEP_TIMEOUT.apply,
      );
      const commitSha = reported(applied.stdout, "SHA");
      if (!commitSha && applied.exitCode === EXIT.installFailed) {
        // The new dependencies could not be linked in the live tree, so the merge never happened.
        const detail = sections(applied.stdout).install ?? applied.stderr;
        return this.reject(operation, externalId, began, [{ source: "install", message: detail.trim() || "The dependencies could not be installed." }], checkMs, diffStat);
      }
      if (!commitSha) {
        await this.discard(externalId).catch(() => undefined);
        this.expectSuccess(applied, "Applying the change");
        throw new OperationAborted("Applying the change failed before the live workspace changed.");
      }
      committed = commitSha;
      await this.update(operation.id, { commitSha });
      await this.pushOrSchedule(sandbox);

      // 9. Health check: request the affected routes; a render failure is reverted.
      this.progress(operation, "loading");
      const routes = affectedRoutes(plan.files.map((file) => file.path));
      const health = await this.exec(externalId, "live", healthScript(), { PLINTH_ROUTES: routes.join(" ") }, STEP_TIMEOUT.health);
      const unhealthy = reported(health.stdout, "UNHEALTHY");
      if (unhealthy) {
        const [route, code] = unhealthy.split(" ");
        const reverted = await this.exec(
          externalId,
          "live",
          revertScript(),
          { ...authorEnv(identity), PLINTH_SUBJECT: subject, PLINTH_OPERATION_ID: operation.id },
          STEP_TIMEOUT.short,
        );
        this.expectSuccess(reverted, "Reverting the change");
        await this.pushOrSchedule(sandbox);
        const failure: OperationFailure = {
          source: "render",
          message: `${route} ${code === "000" ? "did not respond" : `returned ${code}`} after the change.${renderErrorSummary(sections(health.stdout).log)}`,
        };
        await this.finish(operation, "reverted", began, { revertSha: reported(reverted.stdout, "SHA"), checkOutput: [failure] as unknown as Prisma.InputJsonValue });
        return;
      }

      if (plan.onApplied) await this.prisma.$transaction((tx) => plan.onApplied!(tx));
      await this.finish(operation, "applied", began, {});
      await this.queueFollowUps(operation, plan.followUps);
    } catch (error) {
      const message = committed
        ? `The change was applied, but Plinth couldn't confirm the page still renders: ${errorText(error)}`
        : describeFailure(error, "The preview stopped while the change was being checked. Nothing was applied.");
      await this.failed(operation, externalId, began, error, message);
    }
  }

  /**
   * Publish (Phase 6): promote the checked draft to main. It runs as an operation, so it holds the portfolio's lock
   * and can never interleave with an edit.
   *
   *   pending push → fetch main (must be a fast-forward) → plinth check + next build in a worktree → push draft:main
   *
   * main only moves after a production build of that exact commit succeeded. A failed push is not retried
   * automatically: a delayed retry could publish a different commit than the one that was checked.
   */
  private async publish(operation: Operation, sandbox: Sandbox): Promise<void> {
    const began = Date.now();
    const externalId = sandbox.externalId!;
    const branch = `${OPERATION_BRANCH_PREFIX}${operation.id}`;
    await this.transition(operation, "staging", { startedAt: new Date(), attempts: { increment: 1 } });

    try {
      // Unpushed work is pushed first, so what is published is exactly what is on draft.
      let stage = await this.exec(externalId, "live", stageScript(), { PLINTH_BRANCH: branch }, STEP_TIMEOUT.short);
      if (stage.exitCode === EXIT.ahead) {
        await this.sync.push(sandbox);
        stage = await this.exec(externalId, "live", stageScript(), { PLINTH_BRANCH: branch }, STEP_TIMEOUT.short);
      }
      if (stage.exitCode === EXIT.dirty) {
        throw new OperationAborted("The workspace has changes Plinth didn't make, so nothing was published. Rebuild the preview to reset it.");
      }
      if (stage.exitCode === EXIT.diverged) {
        throw new OperationAborted("The draft branch changed outside Plinth, so nothing was published. Rebuild the preview to pick up the changes.");
      }
      this.expectSuccess(stage, "Preparing to publish");

      const token = await this.git.installationToken();
      const status = await this.exec(externalId, "live", publishStatusScript(), gitAuthEnv(token), STEP_TIMEOUT.short);
      this.expectSuccess(status, "Reading the published version");
      const head = reported(status.stdout, "HEAD")!;
      const aheadBy = Number(reported(status.stdout, "AHEAD_BY") ?? 0);
      if (reported(status.stdout, "FAST_FORWARD") !== "1") {
        throw new OperationAborted("The live branch (main) has changes that aren't in your draft, so publishing stopped rather than overwrite them.");
      }
      if (aheadBy === 0) {
        await this.discard(externalId);
        await this.finish(operation, "applied", began, { commitSha: head, diff: "Nothing new to publish: the live site already has every change." });
        return;
      }

      // Pre-flight: the slot contract and a production build of exactly this commit.
      await this.transition(operation, "checking", { diff: `${aheadBy} change${aheadBy === 1 ? "" : "s"} to publish` });
      const built = await this.exec(externalId, "staging", buildScript(), await this.buildSecrets(operation.portfolioId), STEP_TIMEOUT.build);
      const parts = sections(built.stdout);
      const checkMs = Number(reported(built.stdout, "CHECK_MS")) || null;
      const buildCode = Number(reported(built.stdout, "BUILD_CODE") ?? 1);
      const failures = [
        ...parsePlinthCheck(parts.plinth ?? "", parts["plinth-err"] ?? "", Number(reported(built.stdout, "PLINTH_CODE") ?? 1)),
        ...(buildCode === 0 ? [] : parseBuildOutput(parts.build ?? built.stderr)),
        ...(reported(built.stdout, "SECRET_LEAK")
          ? [{ source: "build" as const, message: `A secret (${reported(built.stdout, "SECRET_LEAK")}) appeared in the files visitors download, so nothing was published. Make sure it's only read in server code.` }]
          : []),
      ];
      if (failures.length) return this.reject(operation, externalId, began, failures, checkMs, `${aheadBy} change${aheadBy === 1 ? "" : "s"} not published`);

      await this.transition(operation, "applying", { checkMs });
      this.progress(operation, "publishing");
      // Hosting is ready before main moves, so a misconfigured host never leaves a published commit undeployed.
      if (this.hosting.configured) {
        const portfolio = await this.prisma.portfolio.findUniqueOrThrow({ where: { id: operation.portfolioId } });
        await this.hosting.prepare(portfolio);
      }
      const pushed = await this.exec(externalId, "live", publishPushScript(), { ...gitAuthEnv(token), PLINTH_SHA: head }, STEP_TIMEOUT.short);
      await this.discard(externalId).catch(() => undefined);
      if (pushed.exitCode !== 0 || reported(pushed.stdout, "PUBLISHED") !== head) {
        const detail = (pushed.stderr || pushed.stdout).split(token).join("[redacted]").trim().slice(-400);
        throw new OperationAborted(`GitHub refused the update to main, so nothing was published: ${detail}`);
      }

      const deployment = await this.prisma.deployment.create({
        data: this.hosting.configured
          ? { portfolioId: operation.portfolioId, operationId: operation.id, commitSha: head, status: "pending" }
          : { portfolioId: operation.portfolioId, operationId: operation.id, commitSha: head, status: "unconfigured", finishedAt: new Date() },
      });
      if (this.hosting.configured) await this.tracking.track(operation.portfolioId, deployment.id);
      await this.finish(operation, "applied", began, {
        commitSha: head,
        diff: `Published ${aheadBy} change${aheadBy === 1 ? "" : "s"} to main.`,
      });
    } catch (error) {
      await this.failed(operation, externalId, began, error, describeFailure(error, "The preview stopped while publishing was being checked. Nothing was published."));
    }
  }

  private async failed(operation: Operation, externalId: string, began: number, error: unknown, message: string) {
    await this.discard(externalId).catch(() => undefined);
    this.logger.warn(`Operation ${operation.id} failed: ${message}`);
    // The database may still say running; have the lifecycle rebuild or resume it straight away.
    if (error instanceof SandboxNotRunningError) await this.waker.wake(operation.portfolioId).catch(() => undefined);
    await this.finish(operation, "failed", began, { error: message });
  }

  /** The secrets for a production build, and the values to look for in its public output. Values never enter a log. */
  private async buildSecrets(portfolioId: string): Promise<Record<string, string>> {
    const env = (await this.secrets?.forPortfolio(portfolioId)) ?? {};
    const entries = Object.entries(env);
    if (entries.length === 0) return {};
    // Short values and email addresses can legitimately appear on a page (an inbox shown on the contact section).
    const probes = entries.filter(([, value]) => value.length >= 12 && !value.includes("@")).map(([key, value]) => `${key}=${value}`);
    return {
      PLINTH_ENV_B64: Buffer.from(renderEnvFile(env)).toString("base64"),
      ...(probes.length ? { PLINTH_PROBES_B64: Buffer.from(probes.join("\0") + "\0").toString("base64") } : {}),
    };
  }

  private async queueFollowUps(operation: Operation, followUps: FollowUp[] | undefined) {
    if (!followUps?.length) return;
    await this.followUps.enqueue(operation.portfolioId, followUps).catch((error) => this.logger.warn(`Follow-ups for ${operation.id} weren't queued: ${errorText(error)}`));
  }

  /** `plinth check` and tsc over the staging worktree, as one structured verdict. Run once per pass. */
  private async check(externalId: string): Promise<{ failures: OperationFailure[]; checkMs: number | null }> {
    const checked = await this.exec(externalId, "staging", checkScript(), {}, STEP_TIMEOUT.check);
    const parts = sections(checked.stdout);
    const tscCode = Number(reported(checked.stdout, "TSC_CODE") ?? 1);
    const plinthCode = Number(reported(checked.stdout, "PLINTH_CODE") ?? 1);
    return {
      checkMs: Number(reported(checked.stdout, "CHECK_MS")) || null,
      failures: [
        ...parsePlinthCheck(parts.plinth ?? "", parts["plinth-err"] ?? "", plinthCode),
        ...(tscCode === 0 ? [] : withFallback(parseTscOutput(parts.tsc ?? ""), parts.tsc, "tsc")),
      ],
    };
  }

  /** The staging worktree as the model should see it — after a pass has written to it, not before. */
  private async readStagedContext(externalId: string) {
    const read = await this.exec(externalId, "staging", contextScript(), { PLINTH_DIRS: CONTEXT_DIRECTORIES.join(" "), PLINTH_MAX_BYTES: String(MAX_CONTEXT_BYTES) }, STEP_TIMEOUT.short);
    this.expectSuccess(read, "Reading your portfolio");
    return parseContext(read.stdout);
  }

  private async planChange(operation: Operation, externalId: string): Promise<Plan> {
    if (operation.type === "copilot") {
      return this.copilot.plan(operation, () => this.readStagedContext(externalId));
    }
    if (operation.type === "edit") {
      return { kind: "change", files: editInputSchema.parse(operation.input).files, tarball: null, onApplied: null };
    }
    return this.integrations.plan(operation, externalId);
  }

  private async mutate(externalId: string, files: FileChange[]) {
    const writes = files.filter((file) => file.content !== null);
    const deletes = files.filter((file) => file.content === null).map((file) => file.path);
    const dirs = [...new Set(writes.map((file) => posix.dirname(file.path)).filter((dir) => dir !== "."))];

    if (dirs.length || deletes.length) {
      const prepared = await this.exec(
        externalId,
        "staging",
        prepareFilesScript(),
        { PLINTH_DIRS: dirs.length ? nulList(dirs) : "", PLINTH_DELETE: deletes.length ? nulList(deletes) : "" },
        STEP_TIMEOUT.short,
      );
      this.expectSuccess(prepared, "Preparing the files");
    }
    for (const file of writes) {
      await this.driver.writeFile(externalId, { root: "staging", path: file.path }, file.content!);
    }
  }

  private async reject(
    operation: Operation,
    externalId: string,
    began: number,
    failures: OperationFailure[],
    checkMs: number | null,
    diff: string | null = null,
  ) {
    // 7. Reject: the worktree is thrown away; the live tree and the preview never saw the change.
    await this.discard(externalId);
    await this.reportRejection(operation, failures);
    await this.finish(operation, "rejected", began, {
      checkMs,
      diff,
      checkOutput: failures as unknown as Prisma.InputJsonValue,
    });
  }

  /**
   * A rejection is the safety net working — but from the user's side it is a change that never arrived, and nothing
   * else reports it. Best-effort: the request that caused it is worth far more than the failure text, so look it up
   * when this was a Plinth AI change, and never let the lookup break the rejection itself.
   */
  private async reportRejection(operation: Operation, failures: OperationFailure[]) {
    if (!this.alerts?.configured) return;
    let request: string | null = null;
    try {
      const messageId = (operation.input as { messageId?: unknown } | null)?.messageId;
      if (typeof messageId === "string") {
        const message = await this.prisma.copilotMessage.findUnique({ where: { id: messageId }, select: { content: true } });
        request = message?.content ?? null;
      }
    } catch {
      // The alert is worth sending without it.
    }
    const first = failures[0];
    this.alerts.send({
      title: "A change was rejected by the safety net",
      level: "warning",
      dedupeKey: `operation:rejected:${first?.source ?? "unknown"}:${requestKey(request ?? operation.summary)}`,
      fields: {
        request: request ? clip(request, 300) : null,
        change: operation.summary,
        type: operation.type,
        failed: first?.source ?? null,
        problem: first ? clip(first.message, 300) : null,
        file: first?.file ?? null,
        portfolio: operation.portfolioId,
        operation: operation.id,
      },
    });
  }

  private async pushOrSchedule(sandbox: Sandbox) {
    try {
      await this.sync.push(sandbox);
    } catch (error) {
      if (!(error instanceof PushFailedError)) throw error;
      // The change is committed in the sandbox; pushing is retried, and the sandbox won't be destroyed before it lands.
      this.logger.warn(`${error.message} — will retry for portfolio ${sandbox.portfolioId}`);
      await this.pushRetries.schedule(sandbox.portfolioId);
    }
  }

  /**
   * An operation left mid-flight by a crashed worker. The lock is held, so nothing else is running it. If its commit
   * reached the live tree it counts as applied; otherwise it failed and the worktree is cleaned up by the next stage.
   */
  private async recoverInterrupted(sandbox: Sandbox) {
    const stuck = await this.prisma.operation.findMany({ where: { portfolioId: sandbox.portfolioId, status: { in: IN_PROGRESS } } });
    for (const operation of stuck) {
      const found = await this.exec(sandbox.externalId!, "live", findOperationCommitScript(), { PLINTH_OPERATION_ID: operation.id }, STEP_TIMEOUT.short).catch(
        () => null,
      );
      const sha = found?.stdout.trim().split(" ")[0];
      if (sha) {
        this.logger.warn(`Operation ${operation.id} was interrupted after applying; recording it as applied`);
        await this.finish(operation, "applied", operation.startedAt?.getTime() ?? Date.now(), { commitSha: sha });
      } else {
        await this.finish(operation, "failed", operation.startedAt?.getTime() ?? Date.now(), {
          error: "Interrupted before it was applied. Nothing changed.",
        });
      }
    }
  }

  /** Refuses malformed input before anything touches the sandbox. Publish is handled by publish(). */
  private validateInput(operation: Operation): void {
    const schema = { edit: editInputSchema, copilot: copilotInputSchema, install: installInputSchema, uninstall: uninstallInputSchema, move: moveInputSchema }[operation.type as string];
    if (!schema) throw new OperationAborted(`Operations of type ${operation.type} aren't supported yet.`);
    const parsed = schema.safeParse(operation.input);
    if (!parsed.success) throw new OperationAborted(`The change is invalid: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }

  private discard(externalId: string) {
    return this.exec(externalId, "live", discardScript(), {}, STEP_TIMEOUT.short);
  }

  private exec(externalId: string, root: WorkspaceRoot, script: string, envs: Record<string, string>, timeoutMs: number) {
    return this.driver.exec(externalId, script, { root, cwd: ".", envs, timeoutMs });
  }

  private expectSuccess(result: ExecResult, step: string) {
    if (result.exitCode !== 0) {
      throw new OperationAborted(`${step} failed: ${(result.stderr || result.stdout).trim().slice(-400) || `exit ${result.exitCode}`}`);
    }
  }

  private async transition(operation: Operation, status: OperationStatus, data: Prisma.OperationUpdateInput = {}) {
    await this.update(operation.id, { ...data, status });
  }

  private async finish(operation: Operation, status: OperationStatus, began: number, data: Prisma.OperationUpdateInput) {
    await this.update(operation.id, { ...data, status, finishedAt: new Date(), totalMs: Date.now() - began });
  }

  /**
   * Says what the operation is doing, without writing to the database. Status changes four times in a run, which
   * leaves someone watching a spinner for most of it; these are the steps in between. Best effort by design — a
   * dropped progress event costs a label, never the change.
   */
  private progress(operation: Operation, step: OperationStep): void {
    void this.events
      .publish(operation.portfolioId, { type: "operation", operationId: operation.id, status: operation.status, at: new Date().toISOString(), step })
      .catch(() => undefined);
  }

  private async update(id: string, data: Prisma.OperationUpdateInput) {
    const operation = await this.prisma.operation.update({ where: { id }, data });
    if (data.status) {
      await this.events
        .publish(operation.portfolioId, { type: "operation", operationId: id, status: operation.status, at: new Date().toISOString() })
        .catch(() => undefined);
    }
    return operation;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeFailure(error: unknown, sandboxGone: string): string {
  if (error instanceof OperationAborted || error instanceof PushFailedError) return error.message;
  if (error instanceof HostingError) return `${error.message} Nothing was published.`;
  if (error instanceof SandboxNotRunningError) return sandboxGone;
  return `Something went wrong, so nothing changed: ${errorText(error)}`;
}

function authorEnv(identity: { name: string; email: string }): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };
}

/** tsc failed but printed nothing parseable: keep the raw output rather than pass. */
function withFallback(failures: OperationFailure[], raw: string | undefined, source: "tsc"): OperationFailure[] {
  if (failures.length) return failures;
  return [{ source, message: (raw ?? "").trim().slice(-800) || "The type-check failed without printing an error." }];
}

/** The most useful line of Next's dev log after a render failure, e.g. `Error: Cannot read properties of undefined`. */
function renderErrorSummary(log: string | undefined): string {
  const line = log
    ?.split("\n")
    .map((l) => l.replace(/^\s*[⨯x]\s*/, "").trim())
    .find((l) => /(Error|Exception):/.test(l));
  return line ? ` ${line.slice(0, 300)}` : "";
}
