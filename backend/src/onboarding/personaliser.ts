import { InjectQueue } from "@nestjs/bullmq";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Queue } from "bullmq";
import { OPERATION_JOB_OPTIONS, OPERATIONS_QUEUE, operationJobId, type OperationJobData } from "../operations/operations.constants";
import { PrismaService } from "../prisma/prisma.service";
import { onboardingThemeSchema, renderPersonalisation, type GitHubProfile } from "./personalisation";

/** Lets tests replace outbound HTTP. */
export const PERSONALISER_FETCH = Symbol("PERSONALISER_FETCH");

export const PERSONALISE_SUMMARY = "Personalise your portfolio";

/**
 * Worker: once a portfolio's repository exists, queues its first change — the GitHub profile, role content and chosen
 * theme — as an ordinary `edit` operation. The operations queue starts the preview if needed, and the safety net
 * checks the generated content like any other change. Runs at most once per portfolio.
 */
@Injectable()
export class Personaliser {
  private readonly logger = new Logger(Personaliser.name);
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(OPERATIONS_QUEUE) private readonly queue: Queue<OperationJobData>,
    @Optional() @Inject(PERSONALISER_FETCH) fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async queueFor(portfolioId: string): Promise<"queued" | "exists" | "skipped"> {
    const portfolio = await this.prisma.portfolio.findUnique({ where: { id: portfolioId }, include: { user: true } });
    if (!portfolio || portfolio.status !== "ready") return "skipped";
    if (portfolio.personaliseOperationId) return "exists";

    const github = portfolio.user.githubId ? await this.githubProfile(portfolio.user.githubLogin) : null;
    const theme = onboardingThemeSchema.safeParse(portfolio.theme);
    const files = renderPersonalisation({
      role: portfolio.role,
      githubLogin: portfolio.user.githubId ? portfolio.user.githubLogin : null,
      displayName: portfolio.user.name,
      github,
      theme: theme.success ? theme.data : null,
    });

    // Claim the portfolio first, so a retried provisioning job can never queue a second personalisation.
    const operation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.operation.create({
        data: { portfolioId, type: "edit", actor: "system", summary: PERSONALISE_SUMMARY, input: { summary: PERSONALISE_SUMMARY, files } as Prisma.InputJsonValue },
      });
      const { count } = await tx.portfolio.updateMany({ where: { id: portfolioId, personaliseOperationId: null }, data: { personaliseOperationId: created.id } });
      if (count === 0) throw new AlreadyQueued();
      return created;
    }).catch((error) => {
      if (error instanceof AlreadyQueued) return null;
      throw error;
    });
    if (!operation) return "exists";

    await this.queue.add("run", { portfolioId, operationId: operation.id }, { jobId: operationJobId(operation.id), ...OPERATION_JOB_OPTIONS });
    this.logger.log(`Queued personalisation for ${portfolioId} (${github ? "with" : "without"} GitHub profile)`);
    return "queued";
  }

  /** Public GitHub data. Failure is not an error: the portfolio is personalised from the account name alone. */
  async githubProfile(login: string): Promise<GitHubProfile | null> {
    const headers = { Accept: "application/vnd.github+json", "User-Agent": "plinth-onboarding" };
    try {
      const [userResponse, reposResponse] = await Promise.all([
        this.fetchImpl(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers, signal: AbortSignal.timeout(8_000) }),
        this.fetchImpl(`https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&sort=updated`, { headers, signal: AbortSignal.timeout(8_000) }),
      ]);
      if (!userResponse.ok) return null;
      const user = (await userResponse.json()) as {
        login: string;
        name: string | null;
        bio: string | null;
        location: string | null;
        blog: string | null;
        email: string | null;
        avatar_url: string | null;
        public_repos: number;
        followers: number;
        created_at: string | null;
      };
      const repos = reposResponse.ok
        ? ((await reposResponse.json()) as { name: string; description: string | null; html_url: string; language: string | null; stargazers_count: number; fork: boolean; archived: boolean }[])
        : [];
      const own = repos.filter((repo) => !repo.fork && !repo.archived && repo.name.toLowerCase() !== login.toLowerCase());
      return {
        login: user.login,
        name: user.name,
        bio: user.bio,
        location: user.location,
        blog: user.blog || null,
        email: user.email,
        avatarUrl: user.avatar_url,
        publicRepos: user.public_repos,
        followers: user.followers,
        createdAt: user.created_at,
        stars: own.reduce((sum, repo) => sum + repo.stargazers_count, 0),
        topRepos: [...own]
          .sort((a, b) => b.stargazers_count - a.stargazers_count || Number(Boolean(b.description)) - Number(Boolean(a.description)))
          .slice(0, 4)
          .map((repo) => ({ name: repo.name, description: repo.description, url: repo.html_url, language: repo.language, stars: repo.stargazers_count })),
      };
    } catch {
      return null;
    }
  }
}

class AlreadyQueued extends Error {}
