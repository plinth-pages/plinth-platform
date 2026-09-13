/**
 * Integration tests: real Postgres (backend/.env), in-memory driver and locks.
 * Run with `pnpm test:int`. Each test creates its own users and deletes them afterwards.
 */
import type { Portfolio, Sandbox } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  DRIVER_METHOD_ARITY,
  SandboxBootstrapError,
  SandboxNotRunningError,
  type CreatedSandbox,
  type DevServerHealth,
  type ExecResult,
  type FileEntry,
  type SandboxDriver,
  type SandboxInfo,
  type Workspace,
} from "./sandbox-driver";
import { InMemorySandboxLocks } from "./sandbox-locks";
import { MAX_CONTINUOUS_RUN_MS, PROVIDER_DEADLINE_SLACK_MS, STARTING_STALE_MS } from "./sandbox.constants";
import { SandboxLifecycle, billedSeconds } from "./sandbox.lifecycle";

process.loadEnvFile(".env");
jest.setTimeout(60_000);

const MIN = 60_000;
const timings = { idlePauseMs: 5 * MIN, destroyAfterPausedMs: 24 * 60 * MIN, rotateAfterMs: 50 * MIN };

/** A scriptable provider. State lives here, like it would at E2B. */
class FakeDriver implements SandboxDriver {
  readonly provider = "fake";
  sandboxes = new Map<string, { state: "running" | "paused"; health: DevServerHealth }>();
  calls: { method: string; args: unknown[] }[] = [];
  bootstrapError: Error | null = null;
  /** Consumed one per restart attempt: true succeeds, false fails. */
  restartResults: boolean[] = [];
  private next = 1;

  async create(portfolioId: string, opts: { timeoutMs: number }): Promise<CreatedSandbox> {
    this.record("create", [portfolioId, opts]);
    const externalId = `fake-${this.next++}`;
    this.sandboxes.set(externalId, { state: "running", health: "healthy" });
    const startedAt = new Date();
    return {
      externalId,
      previewUrl: `https://3000-${externalId}.test`,
      accessToken: `traffic-${externalId}`,
      startedAt,
      expiresAt: new Date(Date.now() + opts.timeoutMs),
    };
  }
  async bootstrap(externalId: string, workspace: Workspace) {
    this.record("bootstrap", [externalId, workspace]);
    if (this.bootstrapError) throw this.bootstrapError;
  }
  async resume(externalId: string, opts: { timeoutMs: number }) {
    this.record("resume", [externalId, opts]);
    const sandbox = this.sandboxes.get(externalId);
    if (!sandbox) throw new SandboxNotRunningError(externalId, "gone");
    sandbox.state = "running";
    return { accessToken: `traffic-${externalId}`, startedAt: new Date(), expiresAt: new Date(Date.now() + opts.timeoutMs) };
  }
  async pause(externalId: string, reason: string) {
    this.record("pause", [externalId, reason]);
    this.sandboxes.get(externalId)!.state = "paused";
  }
  async destroy(externalId: string, reason: string) {
    this.record("destroy", [externalId, reason]);
    this.sandboxes.delete(externalId);
  }
  async extend(externalId: string, timeoutMs: number) {
    this.record("extend", [externalId, timeoutMs]);
    return { expiresAt: new Date(Date.now() + timeoutMs) };
  }
  async info(externalId: string): Promise<SandboxInfo> {
    const sandbox = this.sandboxes.get(externalId);
    return { state: sandbox?.state ?? "gone", startedAt: null, expiresAt: null };
  }
  async health(externalId: string) {
    return this.sandboxes.get(externalId)!.health;
  }
  async restartDevServer(externalId: string, opts: { clearCache: boolean }) {
    this.record("restartDevServer", [externalId, opts]);
    if (this.restartResults.shift() === false) throw new SandboxBootstrapError("dev_server", "still down");
    this.sandboxes.get(externalId)!.health = "healthy";
  }
  async exec(): Promise<ExecResult> {
    return { exitCode: 0, stdout: "", stderr: "" };
  }
  async readFile() {
    return "";
  }
  async writeFile() {}
  async listFiles(): Promise<FileEntry[]> {
    return [];
  }

  called(method: string) {
    return this.calls.filter((c) => c.method === method);
  }
  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
  }
}

const prisma = new PrismaService();
const createdUsers: string[] = [];
/** Portfolios created by the current test; every sweep is scoped to them. */
const mine: string[] = [];
const TOKEN = "ghs_fake_installation_token";

let driver: FakeDriver;
let locks: InMemorySandboxLocks;
let lifecycle: SandboxLifecycle;
let events: { portfolioId: string; status: string }[];
const publisher = { publish: async (portfolioId: string, event: { status: string }) => void events.push({ portfolioId, status: event.status }) };

async function readyPortfolio(): Promise<Portfolio> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({ data: { githubId: `sbx-${suffix}`, githubLogin: `sbx-${suffix}` } });
  createdUsers.push(user.id);
  const portfolio = await prisma.portfolio.create({
    data: { userId: user.id, role: "developer", status: "ready", repoName: `portfolio-sbx-${suffix}`, repoId: "1" },
  });
  mine.push(portfolio.id);
  return portfolio;
}

const row = (portfolioId: string) => prisma.sandbox.findUniqueOrThrow({ where: { portfolioId } });
const setRow = (portfolioId: string, data: Partial<Sandbox>) => prisma.sandbox.update({ where: { portfolioId }, data });
const ago = (ms: number, from = new Date()) => new Date(from.getTime() - ms);

beforeAll(() => prisma.$connect());

beforeEach(() => {
  mine.length = 0;
  events = [];
  driver = new FakeDriver();
  locks = new InMemorySandboxLocks();
  lifecycle = new SandboxLifecycle(prisma, driver, locks, { installationToken: async () => TOKEN }, { org: "plinth-pages", timings }, publisher);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

it("the fake driver implements the full driver contract", () => {
  for (const [method, arity] of Object.entries(DRIVER_METHOD_ARITY)) {
    if (["exec", "readFile", "writeFile", "listFiles"].includes(method)) continue; // unused stubs
    expect({ method, length: (driver as unknown as Record<string, () => void>)[method].length }).toEqual({ method, length: arity });
  }
});

describe("ensure", () => {
  it("builds a sandbox from the draft branch and records the cold start", async () => {
    const portfolio = await readyPortfolio();
    expect(await lifecycle.ensure(portfolio.id)).toBe("created");

    const sandbox = await row(portfolio.id);
    expect(sandbox).toMatchObject({ status: "running", externalId: "fake-1", previewUrl: "https://3000-fake-1.test", lastError: null });
    expect(sandbox.coldStartMs).toEqual(expect.any(Number));
    expect(sandbox.runStartedAt).not.toBeNull();

    const [, workspace] = driver.called("bootstrap")[0].args as [string, Workspace];
    expect(workspace).toEqual({
      cloneUrl: `https://github.com/plinth-pages/${portfolio.repoName}.git`,
      branch: "draft",
      gitToken: TOKEN,
      env: {},
    });
    expect(sandbox.trafficToken).toBe("traffic-fake-1");
    expect(events.filter((e) => e.portfolioId === portfolio.id).map((e) => e.status)).toEqual(["starting", "running"]);
    // After bootstrapping, the provider deadline shrinks from the bootstrap allowance to the idle window.
    expect(driver.called("extend")[0].args[1]).toBeLessThanOrEqual(timings.idlePauseMs + PROVIDER_DEADLINE_SLACK_MS);
  });

  it("leaves a healthy running sandbox alone", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    driver.calls = [];

    expect(await lifecycle.ensure(portfolio.id)).toBe("running");
    expect(driver.calls).toEqual([]);
  });

  it("resumes a paused sandbox with an explicit timeout and keeps the same workspace", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    await setRow(portfolio.id, { lastAccessedAt: ago(10 * MIN) });
    await lifecycle.sweep(new Date(), mine);
    expect((await row(portfolio.id)).status).toBe("paused");

    await setRow(portfolio.id, { lastAccessedAt: new Date() });
    expect(await lifecycle.ensure(portfolio.id)).toBe("resumed");

    const sandbox = await row(portfolio.id);
    expect(sandbox).toMatchObject({ status: "running", externalId: "fake-1", pausedAt: null });
    expect(sandbox.resumeMs).toEqual(expect.any(Number));
    const [, opts] = driver.called("resume")[0].args as [string, { timeoutMs: number }];
    expect(opts.timeoutMs).toBeGreaterThan(timings.idlePauseMs);
    expect(driver.called("create")).toHaveLength(1);
  });

  it("rebuilds from GitHub when the provider has lost the sandbox", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    driver.sandboxes.clear();

    expect(await lifecycle.ensure(portfolio.id)).toBe("created");
    expect((await row(portfolio.id)).externalId).toBe("fake-2");
  });

  it("marks the preview unhealthy, keeps the error and leaves nothing running when bootstrap fails", async () => {
    const portfolio = await readyPortfolio();
    driver.bootstrapError = new SandboxBootstrapError("install", "ERR_PNPM_OUTDATED_LOCKFILE");

    expect(await lifecycle.ensure(portfolio.id)).toBe("failed");
    const sandbox = await row(portfolio.id);
    expect(sandbox).toMatchObject({ status: "unhealthy", externalId: null, previewUrl: null, runStartedAt: null });
    expect(sandbox.lastError).toContain("ERR_PNPM_OUTDATED_LOCKFILE");
    expect(driver.called("destroy")[0].args).toEqual(["fake-1", "bootstrap_failed"]);
    expect(driver.sandboxes.size).toBe(0);
  });

  it("skips a portfolio whose repository is not ready", async () => {
    const portfolio = await readyPortfolio();
    await prisma.portfolio.update({ where: { id: portfolio.id }, data: { status: "provisioning" } });
    expect(await lifecycle.ensure(portfolio.id)).toBe("skipped");
    expect(driver.called("create")).toHaveLength(0);
  });

  it("reports busy instead of waiting when another operation holds the sandbox", async () => {
    const portfolio = await readyPortfolio();
    locks.held.add(portfolio.id);
    expect(await lifecycle.ensure(portfolio.id)).toBe("busy");
    expect(driver.calls).toEqual([]);
  });

  it("throws away a sandbox whose earlier start was interrupted", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    await setRow(portfolio.id, { status: "starting" });

    expect(await lifecycle.ensure(portfolio.id)).toBe("created");
    expect(driver.called("destroy")[0].args).toEqual(["fake-1", "start_timed_out"]);
  });
});

describe("private previews (gate G2)", () => {
  it("replaces a running sandbox that was created without a traffic token", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    await setRow(portfolio.id, { trafficToken: null });

    expect(await lifecycle.ensure(portfolio.id)).toBe("created");
    expect(driver.called("destroy")[0].args).toEqual(["fake-1", "rebuild"]);
    expect(await row(portfolio.id)).toMatchObject({ externalId: "fake-2", trafficToken: "traffic-fake-2" });
  });

  it("clears the token when the sandbox is destroyed", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    await driver.pause("fake-1", "idle");
    await setRow(portfolio.id, { status: "paused", pausedAt: ago(25 * 60 * MIN), runStartedAt: null });
    await lifecycle.sweep(new Date(), mine);
    expect(await row(portfolio.id)).toMatchObject({ status: "destroyed", trafficToken: null, previewUrl: null });
  });
});

describe("recovery ladder", () => {
  it("restarts the dev server first, without clearing the cache", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    driver.sandboxes.get("fake-1")!.health = "unreachable";

    expect(await lifecycle.ensure(portfolio.id)).toBe("recovered");
    expect(driver.called("restartDevServer").map((c) => c.args[1])).toEqual([{ clearCache: false }]);
    expect(driver.called("create")).toHaveLength(1);
    expect((await row(portfolio.id)).status).toBe("running");
  });

  it("clears .next next, and only rebuilds when both restarts fail", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    driver.sandboxes.get("fake-1")!.health = "unreachable";
    driver.restartResults = [false, false];

    expect(await lifecycle.restart(portfolio.id)).toBe("created");
    expect(driver.called("restartDevServer").map((c) => c.args[1])).toEqual([{ clearCache: false }, { clearCache: true }]);
    expect(driver.called("destroy")[0].args).toEqual(["fake-1", "unrecoverable"]);
    expect((await row(portfolio.id)).externalId).toBe("fake-2");
  });
});

describe("rebuild", () => {
  it("destroys the current sandbox and builds a new one", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);

    expect(await lifecycle.rebuild(portfolio.id)).toBe("created");
    expect(driver.called("destroy")[0].args).toEqual(["fake-1", "rebuild"]);
    expect(await row(portfolio.id)).toMatchObject({ status: "running", externalId: "fake-2" });
  });
});

describe("sweep", () => {
  it("pauses a sandbox idle for longer than the idle window and bills the stretch", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    const now = new Date();
    await setRow(portfolio.id, { lastAccessedAt: ago(6 * MIN, now), runStartedAt: ago(20 * MIN, now), expiresAt: null });

    const report = await lifecycle.sweep(now, mine);
    expect(report.paused).toEqual([portfolio.id]);
    expect(driver.called("pause")[0].args).toEqual(["fake-1", "idle"]);
    const sandbox = await row(portfolio.id);
    expect(sandbox).toMatchObject({ status: "paused", runStartedAt: null, expiresAt: null });
    expect(sandbox.pausedAt?.getTime()).toBe(now.getTime());
    expect(sandbox.secondsUsed).toBe(20 * 60);
  });

  it("keeps an active sandbox running and moves the provider deadline to just after the idle window", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    const now = new Date();
    await setRow(portfolio.id, { lastAccessedAt: ago(1 * MIN, now), runStartedAt: ago(10 * MIN, now) });

    expect((await lifecycle.sweep(now, mine)).extended).toEqual([portfolio.id]);
    const timeout = driver.called("extend").at(-1)!.args[1];
    expect(timeout).toBe(timings.idlePauseMs + PROVIDER_DEADLINE_SLACK_MS - 1 * MIN);
    expect((await row(portfolio.id)).status).toBe("running");
  });

  it("never sets a deadline past the continuous-runtime cap", async () => {
    // With the default timings rotation happens first; a late rotation must still not ask for more than the cap.
    lifecycle = new SandboxLifecycle(prisma, driver, locks, { installationToken: async () => TOKEN }, {
      org: "plinth-pages",
      timings: { ...timings, rotateAfterMs: 57 * MIN },
    }, publisher);
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    const now = new Date();
    await setRow(portfolio.id, { lastAccessedAt: now, runStartedAt: ago(54 * MIN, now) });

    await lifecycle.sweep(now, mine);
    expect(driver.called("extend").at(-1)!.args[1]).toBe(MAX_CONTINUOUS_RUN_MS - 54 * MIN);
  });

  it("rotates an active sandbox before the provider's 1-hour cap", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    const now = new Date();
    await setRow(portfolio.id, { lastAccessedAt: now, runStartedAt: ago(51 * MIN, now), expiresAt: null });

    expect((await lifecycle.sweep(now, mine)).rotated).toEqual([portfolio.id]);
    expect(driver.called("pause")[0].args).toEqual(["fake-1", "rotation"]);
    expect(driver.called("resume")).toHaveLength(1);
    const sandbox = await row(portfolio.id);
    expect(sandbox.status).toBe("running");
    expect(sandbox.secondsUsed).toBe(51 * 60);
    expect(sandbox.runStartedAt!.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it("destroys a sandbox paused for longer than the destroy threshold", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    await driver.pause("fake-1", "idle");
    await setRow(portfolio.id, { status: "paused", pausedAt: ago(25 * 60 * MIN), runStartedAt: null });

    expect((await lifecycle.sweep(new Date(), mine)).destroyed).toContain(portfolio.id);
    expect(driver.called("destroy")[0].args).toEqual(["fake-1", "idle_too_long"]);
    expect(await row(portfolio.id)).toMatchObject({ status: "destroyed", externalId: null, pausedAt: null });
  });

  it("records a pause the provider made on its own, billing only up to its deadline", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    const now = new Date();
    await driver.pause("fake-1", "idle");
    await setRow(portfolio.id, { lastAccessedAt: ago(2 * MIN, now), runStartedAt: ago(30 * MIN, now), expiresAt: ago(10 * MIN, now) });

    expect((await lifecycle.sweep(now, mine)).reconciled).toEqual([portfolio.id]);
    const sandbox = await row(portfolio.id);
    expect(sandbox.status).toBe("paused");
    expect(sandbox.secondsUsed).toBe(20 * 60);
    expect(sandbox.pausedAt!.getTime()).toBe(now.getTime() - 10 * MIN);
  });

  it("gives up on a start abandoned by a crashed worker", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    const now = new Date(Date.now() + STARTING_STALE_MS + MIN);
    await setRow(portfolio.id, { status: "starting" });

    expect((await lifecycle.sweep(now, mine)).destroyed).toContain(portfolio.id);
    const sandbox = await row(portfolio.id);
    expect(sandbox).toMatchObject({ status: "unhealthy", externalId: null });
    expect(sandbox.lastError).toMatch(/took too long/);
  });

  it("skips a sandbox another operation holds, and carries on with the rest", async () => {
    const [held, free] = [await readyPortfolio(), await readyPortfolio()];
    await lifecycle.ensure(held.id);
    await lifecycle.ensure(free.id);
    const now = new Date();
    await setRow(held.id, { lastAccessedAt: ago(10 * MIN, now) });
    await setRow(free.id, { lastAccessedAt: ago(10 * MIN, now) });
    locks.held.add(held.id);

    const report = await lifecycle.sweep(now, mine);
    expect(report.busy).toContain(held.id);
    expect(report.paused).toContain(free.id);
    expect((await row(held.id)).status).toBe("running");
  });
});

describe("markFailed", () => {
  it("destroys whatever a failed start left behind", async () => {
    const portfolio = await readyPortfolio();
    await lifecycle.ensure(portfolio.id);
    await setRow(portfolio.id, { status: "starting" });

    await lifecycle.markFailed(portfolio.id, "The preview could not start: E2B unavailable");
    expect(await row(portfolio.id)).toMatchObject({ status: "unhealthy", externalId: null, lastError: "The preview could not start: E2B unavailable" });
  });
});

describe("billedSeconds", () => {
  it("caps the stretch at the provider deadline and ignores sandboxes that are not running", () => {
    const start = new Date("2026-09-13T10:00:00Z");
    expect(billedSeconds({ runStartedAt: start, expiresAt: null }, new Date("2026-09-13T10:05:00Z"))).toBe(300);
    expect(billedSeconds({ runStartedAt: start, expiresAt: new Date("2026-09-13T10:02:00Z") }, new Date("2026-09-13T10:05:00Z"))).toBe(120);
    expect(billedSeconds({ runStartedAt: null, expiresAt: null }, new Date())).toBe(0);
  });
});
