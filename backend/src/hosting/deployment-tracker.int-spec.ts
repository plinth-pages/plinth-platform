/**
 * Integration tests for following a deployment on Vercel: real Postgres (backend/.env), a scripted Vercel client.
 * Run with `pnpm test:int`.
 */
import type { ConfigService } from "@nestjs/config";
import type { Portfolio } from "@prisma/client";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { AUTO_DEPLOY_GRACE_MS, DEPLOY_TIMEOUT_MS, DeploymentTracker } from "./hosting";
import type { VercelClient, VercelDeployment } from "./vercel.client";

process.loadEnvFile(".env");
jest.setTimeout(60_000);

class FakeVercel {
  found: VercelDeployment | null = null;
  states: VercelDeployment["readyState"][] = [];
  created: { project: { id: string; name: string }; org: string; repo: string; sha: string }[] = [];
  aliases = ["portfolio-trk.vercel.app", "portfolio-trk-git-main-team.vercel.app"];

  async findProductionDeployment() {
    return this.found;
  }
  async createProductionDeployment(project: { id: string; name: string }, org: string, repo: string, sha: string) {
    this.created.push({ project, org, repo, sha });
    return this.deployment("dpl_created", "QUEUED");
  }
  /** null: fall back to the deployment's aliases, as when Vercel doesn't list a domain yet. */
  productionDomainName: string | null = null;
  async productionDomain() {
    return this.productionDomainName;
  }
  async getDeployment(id: string) {
    const state = this.states.length > 1 ? this.states.shift()! : (this.states[0] ?? "QUEUED");
    return this.deployment(id, state);
  }
  deployment(id: string, readyState: VercelDeployment["readyState"]): VercelDeployment {
    return {
      id,
      readyState,
      url: `${id}.vercel.app`,
      aliases: readyState === "READY" ? this.aliases : [],
      errorMessage: readyState === "ERROR" ? "Command \"next build\" exited with 1" : null,
    };
  }
}

const prisma = new PrismaService();
const config = { get: (key: keyof Env) => ({ GITHUB_ORG: "plinth-pages" })[key as "GITHUB_ORG"] } as unknown as ConfigService<Env, true>;
const users: string[] = [];
let vercel: FakeVercel;
let events: string[];
let tracker: DeploymentTracker;

async function publishedPortfolio(): Promise<{ portfolio: Portfolio; deploymentId: string }> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const user = await prisma.user.create({ data: { githubId: `trk-${suffix}`, githubLogin: `trk-${suffix}` } });
  users.push(user.id);
  const portfolio = await prisma.portfolio.create({
    data: { userId: user.id, role: "developer", status: "ready", repoName: `portfolio-trk-${suffix}`, repoId: "1", vercelProjectId: "prj_1" },
  });
  const deployment = await prisma.deployment.create({ data: { portfolioId: portfolio.id, commitSha: "abc123", status: "pending" } });
  return { portfolio, deploymentId: deployment.id };
}

const row = (id: string) => prisma.deployment.findUniqueOrThrow({ where: { id } });
const later = (ms: number) => new Date(Date.now() + ms);

beforeAll(() => prisma.$connect());
beforeEach(() => {
  vercel = new FakeVercel();
  events = [];
  tracker = new DeploymentTracker(vercel as unknown as VercelClient, prisma, { publish: async (_: string, e: { status: string }) => void events.push(e.status) }, config);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it("uses the deployment Vercel started from the push to main and follows it to the live URL", async () => {
  const { deploymentId } = await publishedPortfolio();
  vercel.found = vercel.deployment("dpl_auto", "BUILDING");
  vercel.states = ["BUILDING", "READY"];

  expect(await tracker.track(deploymentId)).toBe("wait");
  expect(await row(deploymentId)).toMatchObject({ status: "building", vercelDeploymentId: "dpl_auto" });
  expect(await tracker.track(deploymentId)).toBe("done");

  expect(await row(deploymentId)).toMatchObject({ status: "ready", url: "https://portfolio-trk.vercel.app", error: null });
  expect(vercel.created).toEqual([]);
  expect(events).toEqual(["building", "ready"]);
});

it("waits for Vercel's own deployment, then starts one for the exact commit if none appears", async () => {
  const { portfolio, deploymentId } = await publishedPortfolio();

  expect(await tracker.track(deploymentId)).toBe("wait");
  expect(vercel.created).toEqual([]);

  expect(await tracker.track(deploymentId, later(AUTO_DEPLOY_GRACE_MS + 1_000))).toBe("wait");
  expect(vercel.created).toEqual([{ project: { id: "prj_1", name: portfolio.repoName.toLowerCase() }, org: "plinth-pages", repo: portfolio.repoName, sha: "abc123" }]);
  expect((await row(deploymentId)).vercelDeploymentId).toBe("dpl_created");
});

it("records a failed build with Vercel's message; the previous version stays live", async () => {
  const { deploymentId } = await publishedPortfolio();
  vercel.found = vercel.deployment("dpl_auto", "ERROR");
  vercel.states = ["ERROR"];

  expect(await tracker.track(deploymentId)).toBe("done");
  const deployment = await row(deploymentId);
  expect(deployment.status).toBe("failed");
  expect(deployment.error).toMatch(/next build.*previous version is still live/);
});

it("gives up after the deployment timeout", async () => {
  const { deploymentId } = await publishedPortfolio();
  expect(await tracker.track(deploymentId, later(DEPLOY_TIMEOUT_MS + 1_000))).toBe("done");
  expect(await row(deploymentId)).toMatchObject({ status: "failed", error: expect.stringContaining("20 minutes") });
});

it("ignores deployments that already finished", async () => {
  const { deploymentId } = await publishedPortfolio();
  await prisma.deployment.update({ where: { id: deploymentId }, data: { status: "ready" } });
  expect(await tracker.track(deploymentId)).toBe("done");
  expect(events).toEqual([]);
});
