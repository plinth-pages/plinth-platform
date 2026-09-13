import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { GITHUB_REPOS, type GitHubRepos, type RepoVisibility } from "../github/github.client";

/** Retryable unless marked otherwise. */
export class ProvisioningError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = "ProvisioningError";
  }
}

/** A repository with the portfolio's name exists but was not generated from our template. Never delete it. */
export class ForeignRepositoryError extends ProvisioningError {
  constructor(message: string) {
    super(message, false);
    this.name = "ForeignRepositoryError";
  }
}

export interface ProvisionerOptions {
  /** How long to wait for GitHub to finish writing a freshly generated repository. */
  branchPollAttempts: number;
  branchPollDelayMs: number;
  /** For new repositories only. From PORTFOLIO_REPO_VISIBILITY. */
  visibility: RepoVisibility;
}

export const PROVISIONER_OPTIONS = Symbol("PROVISIONER_OPTIONS");
export const DEFAULT_PROVISIONER_OPTIONS: Omit<ProvisionerOptions, "visibility"> = { branchPollAttempts: 20, branchPollDelayMs: 1500 };

const DRAFT_BRANCH = "draft";
const PRODUCTION_BRANCH = "main";

/**
 * Turns a `provisioning` portfolio into a private repository with `main` and `draft` branches.
 * Every step checks before acting, so running it again after any failure picks up where it stopped.
 */
@Injectable()
export class Provisioner {
  private readonly logger = new Logger(Provisioner.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(GITHUB_REPOS) private readonly github: GitHubRepos,
    @Inject(PROVISIONER_OPTIONS) private readonly options: ProvisionerOptions,
  ) {}

  async provision(portfolioId: string): Promise<"ready" | "skipped"> {
    const portfolio = await this.prisma.portfolio.findUnique({ where: { id: portfolioId }, include: { user: true } });
    if (!portfolio || portfolio.status !== "provisioning") return "skipped";

    await this.prisma.portfolio.update({ where: { id: portfolioId }, data: { provisionAttempts: { increment: 1 } } });
    const name = portfolio.repoName;

    let repo = await this.github.getRepo(name);
    if (repo && repo.templateFullName !== this.github.templateFullName) {
      throw new ForeignRepositoryError(
        `A repository named ${name} already exists in ${this.github.org} and was not created by Plinth. It was left untouched.`,
      );
    }
    if (!repo) {
      repo = await this.github.generateFromTemplate(
        name,
        `Portfolio for @${portfolio.user.githubLogin} — built with Plinth`,
        this.options.visibility,
      );
      this.logger.log(`Generated ${repo.fullName} (${this.options.visibility}) for portfolio ${portfolioId}`);
    }

    const mainSha = await this.waitForBranch(name, PRODUCTION_BRANCH);
    if (!(await this.github.getBranchSha(name, DRAFT_BRANCH))) {
      await this.github.createBranch(name, DRAFT_BRANCH, mainSha);
    }

    await this.prisma.portfolio.update({
      where: { id: portfolioId },
      data: { status: "ready", repoId: repo.id, failureReason: null },
    });
    return "ready";
  }

  /**
   * Records a permanent failure. Deletes the repository only when it was generated from our template for a
   * portfolio that never became ready — so no user work can be in it — and never for a foreign repository.
   */
  async fail(portfolioId: string, reason: string, { deleteRepo }: { deleteRepo: boolean }): Promise<void> {
    const portfolio = await this.prisma.portfolio.findUnique({ where: { id: portfolioId } });
    if (!portfolio || portfolio.status === "ready") return;

    if (deleteRepo) {
      const repo = await this.github.getRepo(portfolio.repoName);
      if (repo && repo.templateFullName === this.github.templateFullName) {
        await this.github.deleteRepo(portfolio.repoName);
        this.logger.warn(`Deleted ${repo.fullName} after provisioning failed: ${reason}`);
      }
    }

    await this.prisma.portfolio.update({
      where: { id: portfolioId },
      data: { status: "failed", failureReason: reason, repoId: null },
    });
  }

  private async waitForBranch(repo: string, branch: string): Promise<string> {
    for (let attempt = 0; attempt < this.options.branchPollAttempts; attempt++) {
      const sha = await this.github.getBranchSha(repo, branch);
      if (sha) return sha;
      await new Promise((resolve) => setTimeout(resolve, this.options.branchPollDelayMs));
    }
    throw new ProvisioningError(`GitHub has not finished creating ${repo} yet.`);
  }
}
