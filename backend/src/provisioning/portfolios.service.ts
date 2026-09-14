import { InjectQueue } from "@nestjs/bullmq";
import type { SetupStatusResponse } from "@plinth-pages/shared";
import type { OnboardingTheme } from "../onboarding/personalisation";
import { setupProgress } from "../onboarding/setup-progress";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Portfolio, PortfolioRole, User } from "@prisma/client";
import type { PortfolioSummary } from "@plinth-pages/shared";
import type { Queue } from "bullmq";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import {
  FREE_PORTFOLIO_LIMIT,
  PROVISION_JOB_OPTIONS,
  PROVISIONING_QUEUE,
  provisionJobId,
  type ProvisionJobData,
} from "./provisioning.constants";
import { repoNameCandidates } from "./repo-name";

export class PortfolioLimitReached extends Error {
  constructor(readonly existingPortfolioId: string) {
    super(`Your free plan includes ${FREE_PORTFOLIO_LIMIT} portfolio.`);
  }
}

@Injectable()
export class PortfoliosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue(PROVISIONING_QUEUE) private readonly queue: Queue<ProvisionJobData>,
  ) {}

  /**
   * Creates the portfolio row and queues provisioning. The plan limit is checked inside a per-user
   * advisory lock — the only place it can be enforced correctly. A UI check is bypassed by a direct API
   * call, and a check outside the lock lets two simultaneous requests both pass.
   */
  async create(user: User, role: PortfolioRole, theme: OnboardingTheme | null = null): Promise<Portfolio> {
    const candidates = repoNameCandidates(user.githubLogin);

    const portfolio = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(CAST(${`provision:${user.id}`} AS text)))`;

        const existing = await tx.portfolio.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (existing.length >= FREE_PORTFOLIO_LIMIT) throw new PortfolioLimitReached(existing[0].id);

        const taken = new Set(
          (await tx.portfolio.findMany({ where: { repoName: { in: candidates } }, select: { repoName: true } })).map(
            (p) => p.repoName,
          ),
        );
        const repoName = candidates.find((name) => !taken.has(name));
        if (!repoName) throw new ConflictException("No repository name is available for this account.");

        return tx.portfolio.create({ data: { userId: user.id, role, repoName, ...(theme ? { theme } : {}) } });
      },
      { timeout: 15_000 },
    );

    // Outside the transaction: if this enqueue is lost, the recovery job finds the portfolio later.
    await this.enqueue(portfolio.id);
    return portfolio;
  }

  list(user: User): Promise<Portfolio[]> {
    return this.prisma.portfolio.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  }

  async get(user: User, id: string): Promise<Portfolio> {
    const portfolio = await this.prisma.portfolio.findFirst({ where: { id, userId: user.id } });
    if (!portfolio) throw new NotFoundException("Portfolio not found");
    return portfolio;
  }

  async retry(user: User, id: string): Promise<Portfolio> {
    const { count } = await this.prisma.portfolio.updateMany({
      where: { id, userId: user.id, status: "failed" },
      data: { status: "provisioning", failureReason: null },
    });
    if (count === 0) {
      const portfolio = await this.get(user, id);
      throw new ConflictException(`Only a failed portfolio can be retried (this one is ${portfolio.status}).`);
    }
    await this.enqueue(id);
    return this.get(user, id);
  }

  async setup(user: User, id: string): Promise<SetupStatusResponse> {
    const portfolio = await this.get(user, id);
    const [sandbox, personalise] = await Promise.all([
      this.prisma.sandbox.findUnique({ where: { portfolioId: id } }),
      portfolio.personaliseOperationId ? this.prisma.operation.findUnique({ where: { id: portfolio.personaliseOperationId } }) : null,
    ]);
    return setupProgress(portfolio, sandbox, personalise);
  }

  toSummary(portfolio: Portfolio): PortfolioSummary {
    const org = this.config.get("GITHUB_ORG", { infer: true });
    return {
      id: portfolio.id,
      role: portfolio.role,
      status: portfolio.status,
      repoName: portfolio.repoName,
      repoUrl: portfolio.repoId ? `https://github.com/${org}/${portfolio.repoName}` : null,
      failureReason: portfolio.failureReason,
      theme: (portfolio.theme as PortfolioSummary["theme"]) ?? null,
      createdAt: portfolio.createdAt.toISOString(),
    };
  }

  private enqueue(portfolioId: string) {
    return this.queue.add("provision", { portfolioId }, { jobId: provisionJobId(portfolioId), ...PROVISION_JOB_OPTIONS });
  }
}
