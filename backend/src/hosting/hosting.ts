import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Deployment, DeploymentStatus, Portfolio } from "@prisma/client";
import type { Env } from "../config/env";
import { PORTFOLIO_EVENTS, type PortfolioEventPublisher } from "../events/portfolio-events";
import { PrismaService } from "../prisma/prisma.service";
import { VercelClient, explainVercelError, liveUrl, vercelProjectName, type VercelDeployment } from "./vercel.client";

export const HOSTING = Symbol("HOSTING");
export const VERCEL_CLIENT = Symbol("VERCEL_CLIENT");

/** Where published portfolios are served. Publishing calls `prepare` before main moves and `track` after. */
export interface Hosting {
  readonly configured: boolean;
  /** Makes sure the portfolio's hosting project exists and can reach its repository. Throws a readable message. */
  prepare(portfolio: Portfolio): Promise<void>;
}

export class HostingError extends Error {}

/** How long to wait for Vercel to start a deployment from the push to main before asking for one explicitly. */
export const AUTO_DEPLOY_GRACE_MS = 45_000;
/** A deployment still not terminal after this long is recorded as failed; Vercel keeps serving the previous one. */
export const DEPLOY_TIMEOUT_MS = 20 * 60_000;
export const TRACK_POLL_MS = 5_000;

@Injectable()
export class VercelHosting implements Hosting {
  private readonly org: string;

  constructor(
    @Inject(VERCEL_CLIENT) private readonly vercel: VercelClient | null,
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.org = config.get("GITHUB_ORG", { infer: true });
  }

  get configured() {
    return this.vercel !== null;
  }

  async prepare(portfolio: Portfolio): Promise<void> {
    if (!this.vercel) return;
    try {
      const project = await this.vercel.ensureProject(vercelProjectName(portfolio.repoName), this.org, portfolio.repoName);
      if (portfolio.vercelProjectId !== project.id) {
        await this.prisma.portfolio.update({ where: { id: portfolio.id }, data: { vercelProjectId: project.id } });
      }
    } catch (error) {
      throw new HostingError(explainVercelError(error, `${this.org}/${portfolio.repoName}`));
    }
  }
}

/**
 * Follows a production deployment on Vercel to a live URL. Runs as a queue job outside the portfolio lock, so editing
 * carries on while Vercel builds. Each call looks once and says whether to look again.
 */
@Injectable()
export class DeploymentTracker {
  private readonly logger = new Logger(DeploymentTracker.name);
  private readonly org: string;

  constructor(
    @Inject(VERCEL_CLIENT) private readonly vercel: VercelClient | null,
    private readonly prisma: PrismaService,
    @Inject(PORTFOLIO_EVENTS) private readonly events: PortfolioEventPublisher,
    config: ConfigService<Env, true>,
  ) {
    this.org = config.get("GITHUB_ORG", { infer: true });
  }

  async track(deploymentId: string, now = new Date()): Promise<"done" | "wait"> {
    const deployment = await this.prisma.deployment.findUnique({ where: { id: deploymentId }, include: { portfolio: true } });
    if (!deployment || !["pending", "building"].includes(deployment.status)) return "done";
    if (!this.vercel) return this.finish(deployment, "unconfigured", {});
    if (now.getTime() - deployment.createdAt.getTime() > DEPLOY_TIMEOUT_MS) {
      return this.finish(deployment, "failed", { error: "Vercel didn't finish the deployment within 20 minutes. The previous version is still live." });
    }

    const { portfolio } = deployment;
    let current: VercelDeployment | null = null;
    if (!deployment.vercelDeploymentId) {
      if (!portfolio.vercelProjectId) return this.finish(deployment, "failed", { error: "The Vercel project for this portfolio is missing." });
      // Vercel normally starts building from the push to main itself; use that deployment rather than start a second.
      current = await this.vercel.findProductionDeployment(portfolio.vercelProjectId, deployment.commitSha);
      if (!current && now.getTime() - deployment.createdAt.getTime() >= AUTO_DEPLOY_GRACE_MS) {
        current = await this.vercel.createProductionDeployment(
          { id: portfolio.vercelProjectId, name: vercelProjectName(portfolio.repoName) },
          this.org,
          portfolio.repoName,
          deployment.commitSha,
        );
        this.logger.log(`Started a production deployment for ${portfolio.repoName}@${deployment.commitSha.slice(0, 7)}`);
      }
      if (!current) return "wait";
      await this.prisma.deployment.update({ where: { id: deployment.id }, data: { vercelDeploymentId: current.id } });
    }

    current = await this.vercel.getDeployment(deployment.vercelDeploymentId ?? current!.id);
    switch (current.readyState) {
      case "READY":
        return this.finish(deployment, "ready", { url: liveUrl(current), error: null });
      case "ERROR":
      case "CANCELED":
      case "BLOCKED":
      case "DELETED":
        return this.finish(deployment, "failed", {
          error: `${current.errorMessage ?? `Vercel reported ${current.readyState.toLowerCase()}.`} The previous version is still live.`,
        });
      default:
        if (deployment.status !== "building" && current.readyState === "BUILDING") {
          await this.prisma.deployment.update({ where: { id: deployment.id }, data: { status: "building" } });
          await this.publish(deployment, "building");
        }
        return "wait";
    }
  }

  /** Called when the tracking job gives up after repeated errors. */
  async giveUp(deploymentId: string, reason: string): Promise<void> {
    const deployment = await this.prisma.deployment.findUnique({ where: { id: deploymentId } });
    if (deployment && ["pending", "building"].includes(deployment.status)) {
      await this.finish(deployment, "failed", { error: `Plinth lost track of the deployment: ${reason}` });
    }
  }

  private async finish(deployment: Deployment, status: DeploymentStatus, data: { url?: string | null; error?: string | null }): Promise<"done"> {
    await this.prisma.deployment.update({ where: { id: deployment.id }, data: { ...data, status, finishedAt: new Date() } });
    await this.publish(deployment, status);
    if (status === "ready") this.logger.log(`Deployment ${deployment.id} is live at ${data.url}`);
    return "done";
  }

  private publish(deployment: Deployment, status: DeploymentStatus) {
    return this.events
      .publish(deployment.portfolioId, { type: "deployment", deploymentId: deployment.id, status, at: new Date().toISOString() })
      .catch(() => undefined);
  }
}

export function createVercelClient(config: ConfigService<Env, true>): VercelClient | null {
  const token = config.get("VERCEL_TOKEN", { infer: true });
  return token ? new VercelClient(token, config.get("VERCEL_TEAM_ID", { infer: true }) || undefined) : null;
}
