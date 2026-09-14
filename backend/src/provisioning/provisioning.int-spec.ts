/**
 * Integration tests: real Postgres (backend/.env), in-memory GitHub and queue.
 * Run with `pnpm test:int`. Each test creates its own users and deletes them afterwards.
 */
import type { ConfigService } from "@nestjs/config";
import type { User } from "@prisma/client";
import { DelayedError, UnrecoverableError, type Job, type Queue } from "bullmq";
import type { Env } from "../config/env";
import type { GitHubRepos, RepoInfo } from "../github/github.client";
import { GitHubApiError, GitHubRateLimitError } from "../github/github.errors";
import { PrismaService } from "../prisma/prisma.service";
import { PortfolioLimitReached, PortfoliosService } from "./portfolios.service";
import { ForeignRepositoryError, Provisioner } from "./provisioner";
import { ProvisioningRecovery } from "./provisioning-recovery";
import { STALE_PROVISIONING_MS, provisionJobId, type ProvisionJobData } from "./provisioning.constants";
import { ProvisioningProcessor } from "./provisioning.processor";

process.loadEnvFile(".env");
jest.setTimeout(60_000);

const TEMPLATE = "plinth-pages/plinth-template";

class FakeGitHub implements GitHubRepos {
  readonly org = "plinth-pages";
  readonly templateFullName = TEMPLATE;
  repos = new Map<string, RepoInfo & { branches: Map<string, string> }>();
  generated: string[] = [];
  visibilities: string[] = [];
  deleted: string[] = [];
  /** Branch lookups that return null before `main` appears, like a freshly generated repository. */
  pendingMainLookups = 0;
  failCreateBranch: Error | null = null;
  failGetRepo: Error | null = null;

  seedForeign(name: string) {
    this.repos.set(name, this.info(name, null));
  }

  async getRepo(name: string) {
    if (this.failGetRepo) throw this.failGetRepo;
    const repo = this.repos.get(name);
    return repo ? { ...repo, branches: undefined } : null;
  }
  async generateFromTemplate(name: string, _description: string, visibility: "public" | "private") {
    this.generated.push(name);
    this.visibilities.push(visibility);
    const repo = this.info(name, TEMPLATE);
    this.repos.set(name, repo);
    return repo;
  }
  async getBranchSha(name: string, branch: string) {
    const repo = this.repos.get(name);
    if (branch === "main" && this.pendingMainLookups > 0) {
      this.pendingMainLookups--;
      return null;
    }
    return repo?.branches.get(branch) ?? null;
  }
  async createBranch(name: string, branch: string, sha: string) {
    if (this.failCreateBranch) throw this.failCreateBranch;
    this.repos.get(name)!.branches.set(branch, sha);
  }
  async compare() {
    return { aheadBy: 0, behindBy: 0 };
  }
  async deleteRepo(name: string) {
    this.deleted.push(name);
    this.repos.delete(name);
  }
  private info(name: string, template: string | null) {
    return {
      id: String(1000 + this.repos.size),
      name,
      fullName: `${this.org}/${name}`,
      htmlUrl: `https://github.com/${this.org}/${name}`,
      private: true,
      templateFullName: template,
      branches: new Map([["main", "sha-main-0001"]]),
    };
  }
}

const prisma = new PrismaService();
const config = { get: (key: keyof Env) => ({ GITHUB_ORG: "plinth-pages" })[key as "GITHUB_ORG"] } as unknown as ConfigService<Env, true>;
const createdUsers: string[] = [];

let github: FakeGitHub;
let queue: { add: jest.Mock };
let portfolios: PortfoliosService;
let provisioner: Provisioner;
let recovery: ProvisioningRecovery;
let processor: ProvisioningProcessor;

async function makeUser(login = "int-user"): Promise<User> {
  const user = await prisma.user.create({
    data: { githubId: `int-${Date.now()}-${Math.random().toString(36).slice(2)}`, githubLogin: `${login}-${Math.random().toString(36).slice(2, 7)}` },
  });
  createdUsers.push(user.id);
  return user;
}

function job(portfolioId: string, attemptsMade = 0, attempts = 5) {
  return {
    name: "provision",
    data: { portfolioId },
    attemptsMade,
    opts: { attempts },
    moveToDelayed: jest.fn(),
  } as unknown as Job<ProvisionJobData> & { moveToDelayed: jest.Mock };
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(() => {
  github = new FakeGitHub();
  queue = { add: jest.fn(async () => ({ id: "job" })) };
  portfolios = new PortfoliosService(prisma, config, queue as unknown as Queue<ProvisionJobData>);
  provisioner = new Provisioner(prisma, github, { branchPollAttempts: 5, branchPollDelayMs: 5, visibility: "public" });
  recovery = new ProvisioningRecovery(prisma, queue as unknown as Queue<ProvisionJobData>);
  processor = new ProvisioningProcessor(provisioner, recovery, { queueFor: async () => "skipped" } as never);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("creating a portfolio", () => {
  it("records it as provisioning and queues a job keyed by the portfolio id", async () => {
    const user = await makeUser();
    const portfolio = await portfolios.create(user, "developer");

    expect(portfolio.status).toBe("provisioning");
    expect(portfolio.repoName).toBe(`portfolio-${user.githubLogin}`);
    expect(queue.add).toHaveBeenCalledWith(
      "provision",
      { portfolioId: portfolio.id },
      expect.objectContaining({ jobId: provisionJobId(portfolio.id), attempts: 5 }),
    );
  });

  it("allows exactly one portfolio when two requests race", async () => {
    const user = await makeUser();
    const results = await Promise.allSettled([portfolios.create(user, "developer"), portfolios.create(user, "designer")]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(PortfolioLimitReached);
    expect(await prisma.portfolio.count({ where: { userId: user.id } })).toBe(1);
  });

  it("refuses a second portfolio on the free plan, pointing at the existing one", async () => {
    const user = await makeUser();
    const first = await portfolios.create(user, "developer");
    const error = await portfolios.create(user, "founder").catch((e) => e);

    expect(error).toBeInstanceOf(PortfolioLimitReached);
    expect(error.existingPortfolioId).toBe(first.id);
  });
});

describe("provisioning", () => {
  it("generates the repository, waits for main, creates draft from it, and marks the portfolio ready", async () => {
    const user = await makeUser();
    const portfolio = await portfolios.create(user, "developer");
    github.pendingMainLookups = 2;

    await expect(processor.process(job(portfolio.id))).resolves.toBe("ready");

    const repo = github.repos.get(portfolio.repoName)!;
    expect(github.generated).toEqual([portfolio.repoName]);
    expect(github.visibilities).toEqual(["public"]); // from PORTFOLIO_REPO_VISIBILITY
    expect(repo.branches.get("draft")).toBe(repo.branches.get("main"));
    const saved = await prisma.portfolio.findUniqueOrThrow({ where: { id: portfolio.id } });
    expect(saved).toMatchObject({ status: "ready", repoId: repo.id, failureReason: null, provisionAttempts: 1 });
  });

  it("adopts a repository an earlier attempt already created instead of generating another", async () => {
    const user = await makeUser();
    const portfolio = await portfolios.create(user, "developer");
    await github.generateFromTemplate(portfolio.repoName, "", "public");
    github.generated = [];

    await processor.process(job(portfolio.id));
    expect(github.generated).toEqual([]);
    expect((await prisma.portfolio.findUniqueOrThrow({ where: { id: portfolio.id } })).status).toBe("ready");
  });

  it("does nothing for a portfolio that is already ready", async () => {
    const user = await makeUser();
    const portfolio = await portfolios.create(user, "developer");
    await processor.process(job(portfolio.id));
    await expect(processor.process(job(portfolio.id))).resolves.toBe("skipped");
    expect(github.generated).toHaveLength(1);
  });

  it("retries a transient failure without cleaning up", async () => {
    const user = await makeUser();
    const portfolio = await portfolios.create(user, "developer");
    github.failCreateBranch = new GitHubApiError(502, "Bad gateway");

    await expect(processor.process(job(portfolio.id, 0))).rejects.toThrow("Bad gateway");
    expect(github.deleted).toEqual([]);
    expect((await prisma.portfolio.findUniqueOrThrow({ where: { id: portfolio.id } })).status).toBe("provisioning");
  });

  it("on the final attempt, deletes the repository it created and records why", async () => {
    const user = await makeUser();
    const portfolio = await portfolios.create(user, "developer");
    github.failCreateBranch = new GitHubApiError(502, "Bad gateway");

    await expect(processor.process(job(portfolio.id, 4, 5))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(github.deleted).toEqual([portfolio.repoName]);
    const saved = await prisma.portfolio.findUniqueOrThrow({ where: { id: portfolio.id } });
    expect(saved).toMatchObject({ status: "failed", repoId: null, failureReason: "GitHub: Bad gateway" });
  });

  it("fails immediately, without deleting, when a foreign repository already has the name", async () => {
    const user = await makeUser();
    const portfolio = await portfolios.create(user, "developer");
    github.seedForeign(portfolio.repoName);

    await expect(processor.process(job(portfolio.id))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(github.deleted).toEqual([]);
    expect(github.repos.has(portfolio.repoName)).toBe(true);
    const saved = await prisma.portfolio.findUniqueOrThrow({ where: { id: portfolio.id } });
    expect(saved.status).toBe("failed");
    expect(saved.failureReason).toMatch(/was not created by Plinth/);
  });

  it("waits out a rate limit without spending an attempt or failing the portfolio", async () => {
    const user = await makeUser();
    const portfolio = await portfolios.create(user, "developer");
    github.failGetRepo = new GitHubRateLimitError(403, "secondary rate limit", 30_000);
    const rateLimited = job(portfolio.id, 4, 5);

    await expect(processor.process(rateLimited, "token")).rejects.toBeInstanceOf(DelayedError);
    expect(rateLimited.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "token");
    expect((await prisma.portfolio.findUniqueOrThrow({ where: { id: portfolio.id } })).status).toBe("provisioning");
  });

  it("can be retried after failing, and then succeeds", async () => {
    const user = await makeUser();
    const portfolio = await portfolios.create(user, "developer");
    github.failCreateBranch = new GitHubApiError(502, "Bad gateway");
    await processor.process(job(portfolio.id, 4, 5)).catch(() => undefined);

    github.failCreateBranch = null;
    await portfolios.retry(user, portfolio.id);
    await expect(processor.process(job(portfolio.id))).resolves.toBe("ready");
  });
});

describe("recovery", () => {
  it("re-queues portfolios stuck in provisioning, and leaves recent ones alone", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const stuck = await portfolios.create(user, "developer");
    const fresh = await portfolios.create(other, "developer");
    const now = new Date();
    await prisma.portfolio.update({
      where: { id: stuck.id },
      data: { updatedAt: new Date(now.getTime() - STALE_PROVISIONING_MS - 60_000) },
    });
    queue.add.mockClear();

    const { requeued } = await recovery.run(now);

    expect(requeued).toContain(stuck.id);
    expect(requeued).not.toContain(fresh.id);
    expect(queue.add).toHaveBeenCalledWith("provision", { portfolioId: stuck.id }, expect.objectContaining({ jobId: provisionJobId(stuck.id) }));

    // The re-queued job then completes it.
    await expect(processor.process(job(stuck.id))).resolves.toBe("ready");
  });
});

describe("guards", () => {
  it("ForeignRepositoryError is never retryable", () => {
    expect(new ForeignRepositoryError("x").retryable).toBe(false);
  });
});
