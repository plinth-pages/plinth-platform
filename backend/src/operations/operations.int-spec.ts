/**
 * Integration tests for the safety net: real Postgres (backend/.env), a simulated sandbox with a git-like model.
 * Run with `pnpm test:int`. Each test creates its own users and deletes them afterwards.
 */
import type { Operation, Portfolio } from "@prisma/client";
import type { OperationFailure } from "@plinth-pages/shared";
import { PrismaService } from "../prisma/prisma.service";
import {
  DRIVER_METHOD_ARITY,
  SandboxNotRunningError,
  type CreatedSandbox,
  type ExecOptions,
  type ExecResult,
  type SandboxDriver,
  type WorkspaceFile,
} from "../sandbox/sandbox-driver";
import { InMemorySandboxLocks } from "../sandbox/sandbox-locks";
import { GitSync } from "./git-sync";
import { OperationRunner } from "./operation-runner";

process.loadEnvFile(".env");
jest.setTimeout(60_000);

type Tree = Map<string, string>;
const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });
const exit = (exitCode: number, stdout = "", stderr = ""): ExecResult => ({ exitCode, stdout, stderr });

/**
 * A sandbox whose scripts are simulated from their `# plinth:step=` tag. It models the live tree, the staging worktree,
 * commits and the remote draft branch, and records every state the live tree was ever in — which is what a poller on
 * the preview could have observed.
 */
class SimulatedSandbox implements SandboxDriver {
  readonly provider = "simulated";
  live: Tree = new Map([
    ["app/page.tsx", 'export default function Page() {\n  return <main><Slot name="sidebar" /></main>;\n}\n'],
    ["content/profile.ts", 'export const profile = { name: "Asha" };\n'],
  ]);
  staging: Tree | null = null;
  commits: { sha: string; message: string; tree: Tree }[] = [];
  head = "base";
  remote = "base";
  dirty = false;
  running = true;
  pushFails = false;
  /** The remote main branch. */
  main = "base";
  /** Returns build log lines when the production build should fail for this tree. */
  buildErrors = (tree: Tree): string[] => ([...tree.values()].some((c) => c.includes("BUILD_BREAKS")) ? ["./app/page.tsx", "20:14  Error: Unescaped entity.  react/no-unescaped-entities"] : []);
  mainPushFails = false;
  /** Every distinct live tree, in order. */
  liveHistory: string[] = [snapshot(this.live)];
  steps: string[] = [];
  /** Runs while the check step executes, e.g. to kill the sandbox mid-operation. */
  duringCheck: (() => void) | null = null;

  // The checks, modelled on the real tools.
  tsc = (tree: Tree) =>
    [...tree].filter(([, c]) => c.includes("TYPE_ERROR")).map(([p]) => `${p}(1,1): error TS2322: Type 'number' is not assignable to type 'string'.`);
  plinth = (tree: Tree) =>
    tree.get("app/page.tsx")?.includes('<Slot name="sidebar"')
      ? { ok: true, issues: [] }
      : { ok: false, issues: [{ code: "SLOT_MISSING", file: "app/page.tsx", message: 'The "sidebar" slot is missing.' }] };
  renders = (tree: Tree) => ![...tree.values()].some((c) => c.includes("RENDER_THROWS"));

  async exec(externalId: string, command: string, opts: ExecOptions): Promise<ExecResult> {
    if (!this.running) throw new SandboxNotRunningError(externalId, "gone");
    const step = /^# plinth:step=([a-z-]+)/.exec(command)?.[1] ?? "unknown";
    this.steps.push(step);
    const env = opts.envs;

    switch (step) {
      case "stage": {
        if (this.dirty) return exit(20, "PLINTH_DIRTY");
        if (this.head !== this.remote) return exit(21, "PLINTH_AHEAD");
        this.staging = new Map(this.live);
        return ok(`PLINTH_HEAD=${this.head}`);
      }
      case "files": {
        const deletes = env.PLINTH_DELETE ? Buffer.from(env.PLINTH_DELETE, "base64").toString().split("\0") : [];
        for (const path of deletes) this.staging!.delete(path);
        return ok();
      }
      case "prepare":
        return snapshot(this.staging!) === snapshot(this.live) ? exit(30, "PLINTH_NO_CHANGES") : ok("---PLINTH:stat---\n 1 file changed");
      case "check": {
        this.duringCheck?.();
        if (!this.running) throw new SandboxNotRunningError(externalId, "gone");
        const tsc = this.tsc(this.staging!);
        const plinth = this.plinth(this.staging!);
        return ok(
          [
            "PLINTH_CHECK_MS=4200",
            `PLINTH_PLINTH_CODE=${plinth.ok ? 0 : 1}`,
            `PLINTH_TSC_CODE=${tsc.length ? 2 : 0}`,
            "---PLINTH:plinth---",
            JSON.stringify(plinth),
            "---PLINTH:plinth-err---",
            "---PLINTH:tsc---",
            ...tsc,
          ].join("\n"),
        );
      }
      case "apply": {
        const sha = `c${this.commits.length + 1}`;
        this.commits.push({ sha, message: `${env.PLINTH_SUBJECT}\n\nOperation-Id: ${env.PLINTH_OPERATION_ID}`, tree: new Map(this.staging!) });
        this.setLive(this.staging!);
        this.head = sha;
        this.staging = null;
        return ok(`PLINTH_SHA=${sha}`);
      }
      case "discard":
        this.staging = null;
        return ok();
      case "push":
        if (this.pushFails) return exit(128, "", "fatal: unable to access 'https://github.com/': Could not resolve host");
        this.remote = this.head;
        return ok(`PLINTH_PUSHED=${this.head}`);
      case "health":
        return this.renders(this.live)
          ? ok("PLINTH_HEALTHY=1")
          : ok("PLINTH_UNHEALTHY=/ 500\n---PLINTH:log---\n ⨯ Error: Plinth safety net test\n    at Page (app/page.tsx:2:9)");
      case "revert": {
        const previous = this.commits.length > 1 ? this.commits[this.commits.length - 2].tree : this.initial;
        const sha = `c${this.commits.length + 1}`;
        this.commits.push({ sha, message: `Revert: ${env.PLINTH_SUBJECT}\n\nOperation-Id: ${env.PLINTH_OPERATION_ID}`, tree: new Map(previous) });
        this.setLive(previous);
        this.head = sha;
        return ok(`PLINTH_SHA=${sha}`);
      }
      case "publish-status": {
        const known = ["base", ...this.commits.map((c) => c.sha)];
        const mainIndex = known.indexOf(this.main);
        const headIndex = known.indexOf(this.head);
        return ok(
          [
            `PLINTH_HEAD=${this.head}`,
            `PLINTH_MAIN=${this.main}`,
            `PLINTH_AHEAD_BY=${Math.max(0, headIndex - mainIndex)}`,
            `PLINTH_FAST_FORWARD=${mainIndex !== -1 && mainIndex <= headIndex ? 1 : 0}`,
          ].join("\n"),
        );
      }
      case "build": {
        const errors = this.buildErrors(this.staging!);
        const plinth = this.plinth(this.staging!);
        return ok(
          [
            `PLINTH_PLINTH_CODE=${plinth.ok ? 0 : 1}`,
            `PLINTH_BUILD_CODE=${errors.length ? 1 : 0}`,
            "PLINTH_CHECK_MS=41000",
            "---PLINTH:plinth---",
            JSON.stringify(plinth),
            "---PLINTH:plinth-err---",
            "---PLINTH:build---",
            ...(errors.length ? ["Failed to compile.", "", ...errors] : ["✓ Compiled successfully"]),
          ].join("\n"),
        );
      }
      case "publish-push":
        if (this.mainPushFails) return exit(1, "", "! [rejected] main (non-fast-forward)");
        this.main = env.PLINTH_SHA;
        return ok(`PLINTH_PUBLISHED=${env.PLINTH_SHA}`);
      case "find-commit": {
        const commit = this.commits.find((c) => c.message.includes(`Operation-Id: ${env.PLINTH_OPERATION_ID}`));
        return ok(commit ? `${commit.sha} ${commit.message.split("\n")[0]}` : "");
      }
      default:
        throw new Error(`Unexpected script: ${step}`);
    }
  }

  async writeFile(externalId: string, file: WorkspaceFile, content: string) {
    if (!this.running) throw new SandboxNotRunningError(externalId, "gone");
    if (file.root !== "staging") throw new Error("The safety net must never write to the live tree directly");
    this.staging!.set(file.path, content);
  }

  readonly initial: Tree = new Map(this.live);
  private setLive(tree: Tree) {
    this.live = new Map(tree);
    this.liveHistory.push(snapshot(this.live));
  }

  // Unused by the runner.
  async create(): Promise<CreatedSandbox> {
    throw new Error("unused");
  }
  async bootstrap() {}
  async resume() {
    return { accessToken: "t", startedAt: new Date(), expiresAt: new Date() };
  }
  async pause() {}
  async destroy() {}
  async extend() {
    return { expiresAt: new Date() };
  }
  async info() {
    return { state: "running" as const, startedAt: null, expiresAt: null };
  }
  async health() {
    return "healthy" as const;
  }
  async restartDevServer() {}
  async readFile() {
    return "";
  }
  async listFiles() {
    return [];
  }
}

function snapshot(tree: Tree): string {
  return JSON.stringify([...tree].sort());
}

const prisma = new PrismaService();
const createdUsers: string[] = [];
const tokens = { installationToken: async () => "ghs_test", botIdentity: async () => ({ name: "plinth-pages[bot]", email: "1+plinth-pages[bot]@users.noreply.github.com" }) };

let sandbox: SimulatedSandbox;
let runner: OperationRunner;
let events: { operationId: string; status: string }[];
let scheduledPushes: string[];
let hosting: { configured: boolean; prepared: string[]; failWith: Error | null; prepare(portfolio: Portfolio): Promise<void> };
let tracked: string[];
let woken: string[];

async function portfolioWithSandbox(): Promise<Portfolio> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({ data: { githubId: `ops-${suffix}`, githubLogin: `ops-${suffix}` } });
  createdUsers.push(user.id);
  const portfolio = await prisma.portfolio.create({
    data: { userId: user.id, role: "developer", status: "ready", repoName: `portfolio-ops-${suffix}`, repoId: "1" },
  });
  await prisma.sandbox.create({ data: { portfolioId: portfolio.id, status: "running", externalId: "sim-1", trafficToken: "t" } });
  return portfolio;
}

async function queueEdit(portfolioId: string, files: { path: string; content: string | null }[], summary = "Test edit"): Promise<Operation> {
  return prisma.operation.create({ data: { portfolioId, type: "edit", actor: "user", summary, input: { files } } });
}

const reload = (id: string) => prisma.operation.findUniqueOrThrow({ where: { id } });
const failuresOf = (operation: Operation) => (operation.checkOutput as OperationFailure[] | null) ?? [];

beforeAll(() => prisma.$connect());

beforeEach(() => {
  sandbox = new SimulatedSandbox();
  events = [];
  scheduledPushes = [];
  tracked = [];
  hosting = {
    configured: false,
    prepared: [],
    failWith: null,
    async prepare(portfolio) {
      // The simulated main must not have moved yet when hosting is prepared.
      this.prepared.push(`${portfolio.id}@${sandbox.main}`);
      if (this.failWith) throw this.failWith;
    },
  };
  woken = [];
  const publisher = { publish: async (_: string, event: { type: string; operationId?: string; status: string }) => void events.push({ operationId: event.operationId!, status: event.status }) };
  runner = new OperationRunner(prisma, sandbox, tokens, new GitSync(prisma, sandbox, tokens), publisher, {
    schedule: async (portfolioId) => void scheduledPushes.push(portfolioId),
  }, { wake: async (portfolioId) => void woken.push(portfolioId) }, hosting, { track: async (_portfolioId, deploymentId) => void tracked.push(deploymentId) });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

it("the simulated sandbox implements the full driver contract", () => {
  for (const [method, arity] of Object.entries(DRIVER_METHOD_ARITY)) {
    if (["exec", "writeFile"].includes(method)) {
      expect({ method, length: (sandbox as unknown as Record<string, () => void>)[method].length }).toEqual({ method, length: arity });
    }
  }
});

describe("a valid edit", () => {
  it("is checked, committed with an Operation-Id trailer, applied to the live tree and pushed to draft", async () => {
    const portfolio = await portfolioWithSandbox();
    const op = await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: 'export const profile = { name: "Asha Menon" };\n' }], "Update name");

    expect(await runner.drain(portfolio.id)).toBe("drained");

    const done = await reload(op.id);
    expect(done).toMatchObject({ status: "applied", commitSha: "c1", checkMs: 4200, error: null });
    expect(done.totalMs).toEqual(expect.any(Number));
    expect(sandbox.commits[0].message).toBe(`Update name\n\nOperation-Id: ${op.id}`);
    expect(sandbox.live.get("content/profile.ts")).toContain("Asha Menon");
    expect(sandbox.remote).toBe("c1");
    expect(sandbox.steps).toEqual(["stage", "files", "prepare", "check", "apply", "push", "health"]);
    expect(events.map((e) => e.status)).toEqual(["staging", "checking", "applying", "applied"]);
  });
});

describe("rejections", () => {
  it("rejects a type error; the live tree, HEAD and draft never change", async () => {
    const portfolio = await portfolioWithSandbox();
    const op = await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: "export const profile = { name: 42 }; // TYPE_ERROR\n" }]);

    await runner.drain(portfolio.id);

    const done = await reload(op.id);
    expect(done.status).toBe("rejected");
    expect(failuresOf(done)).toEqual([
      { source: "tsc", file: "content/profile.ts", line: 1, code: "TS2322", message: "Type 'number' is not assignable to type 'string'." },
    ]);
    expect(sandbox.liveHistory).toHaveLength(1); // a poller on the preview could never have seen the error
    expect(sandbox.head).toBe("base");
    expect(sandbox.remote).toBe("base");
    expect(sandbox.staging).toBeNull();
    expect(sandbox.steps).toEqual(["stage", "files", "prepare", "check", "discard"]);
  });

  it("rejects an edit that deletes a slot, through plinth check", async () => {
    const portfolio = await portfolioWithSandbox();
    const op = await queueEdit(portfolio.id, [{ path: "app/page.tsx", content: "export default function Page() {\n  return <main />;\n}\n" }]);

    await runner.drain(portfolio.id);

    const done = await reload(op.id);
    expect(done.status).toBe("rejected");
    expect(failuresOf(done)).toEqual([{ source: "plinth", code: "SLOT_MISSING", file: "app/page.tsx", message: 'The "sidebar" slot is missing.' }]);
    expect(sandbox.liveHistory).toHaveLength(1);
  });

  it("reports both checks when both fail", async () => {
    const portfolio = await portfolioWithSandbox();
    const op = await queueEdit(portfolio.id, [{ path: "app/page.tsx", content: "export default function Page() { return 1; } // TYPE_ERROR\n" }]);
    await runner.drain(portfolio.id);
    expect(failuresOf(await reload(op.id)).map((f) => f.source)).toEqual(["plinth", "tsc"]);
  });
});

describe("render health check", () => {
  it("reverts an edit that type-checks but throws at render, and pushes the revert", async () => {
    const portfolio = await portfolioWithSandbox();
    const op = await queueEdit(portfolio.id, [
      { path: "app/page.tsx", content: 'export default function Page() {\n  throw new Error("RENDER_THROWS");\n  return <main><Slot name="sidebar" /></main>;\n}\n' },
    ]);

    await runner.drain(portfolio.id);

    const done = await reload(op.id);
    expect(done).toMatchObject({ status: "reverted", commitSha: "c1", revertSha: "c2" });
    expect(failuresOf(done)).toEqual([{ source: "render", message: "/ returned 500 after the change. Error: Plinth safety net test" }]);
    expect(snapshot(sandbox.live)).toBe(snapshot(sandbox.initial));
    expect(sandbox.commits[1].message).toContain(`Operation-Id: ${op.id}`);
    expect(sandbox.remote).toBe("c2");
  });
});

describe("ordering and concurrency", () => {
  it("runs operations submitted together one after the other, oldest first", async () => {
    const portfolio = await portfolioWithSandbox();
    const first = await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: 'export const profile = { name: "One" };\n' }], "First");
    const second = await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: 'export const profile = { name: "Two" };\n' }], "Second");

    const locks = new InMemorySandboxLocks();
    const [a, b] = await Promise.all([locks.run(portfolio.id, () => runner.drain(portfolio.id)), locks.run(portfolio.id, () => runner.drain(portfolio.id))]);

    expect([a.acquired, b.acquired].sort()).toEqual([false, true]);
    const [one, two] = [await reload(first.id), await reload(second.id)];
    expect([one.status, two.status]).toEqual(["applied", "applied"]);
    expect(one.finishedAt!.getTime()).toBeLessThanOrEqual(two.startedAt!.getTime());
    expect(sandbox.commits.map((c) => c.message.split("\n")[0])).toEqual(["First", "Second"]);
    expect(sandbox.live.get("content/profile.ts")).toContain("Two");
  });
});

describe("pushing", () => {
  it("keeps an applied change when the push fails, marks it pending and schedules a retry", async () => {
    const portfolio = await portfolioWithSandbox();
    sandbox.pushFails = true;
    const op = await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: 'export const profile = { name: "Offline" };\n' }]);

    await runner.drain(portfolio.id);

    expect((await reload(op.id)).status).toBe("applied");
    expect(await prisma.sandbox.findUniqueOrThrow({ where: { portfolioId: portfolio.id } })).toMatchObject({ pendingPush: true });
    expect(scheduledPushes).toEqual([portfolio.id]);
    expect(sandbox.remote).toBe("base");
  });

  it("pushes an earlier unpushed commit before staging the next operation", async () => {
    const portfolio = await portfolioWithSandbox();
    sandbox.pushFails = true;
    await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: 'export const profile = { name: "A" };\n' }]);
    await runner.drain(portfolio.id);
    sandbox.pushFails = false;

    const next = await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: 'export const profile = { name: "B" };\n' }]);
    sandbox.steps = [];
    await runner.drain(portfolio.id);

    expect((await reload(next.id)).status).toBe("applied");
    expect(sandbox.steps.slice(0, 3)).toEqual(["stage", "push", "stage"]);
    expect(sandbox.remote).toBe("c2");
    expect(await prisma.sandbox.findUniqueOrThrow({ where: { portfolioId: portfolio.id } })).toMatchObject({ pendingPush: false });
  });
});

async function queuePublish(portfolioId: string): Promise<Operation> {
  return prisma.operation.create({ data: { portfolioId, type: "publish", actor: "user", summary: "Publish", input: {} } });
}

describe("publishing", () => {
  it("builds the draft and fast-forwards main to it, recording the deployment", async () => {
    const portfolio = await portfolioWithSandbox();
    await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: 'export const profile = { name: "Live" };\n' }]);
    await runner.drain(portfolio.id);
    const publish = await queuePublish(portfolio.id);
    sandbox.steps = [];

    await runner.drain(portfolio.id);

    const done = await reload(publish.id);
    expect(done).toMatchObject({ status: "applied", commitSha: "c1", checkMs: 41000, diff: "Published 1 change to main." });
    expect(sandbox.main).toBe("c1");
    expect(sandbox.steps).toEqual(["stage", "publish-status", "build", "publish-push", "discard"]);
    expect(sandbox.liveHistory).toHaveLength(2); // publishing never touches the live tree
    const deployment = await prisma.deployment.findUniqueOrThrow({ where: { operationId: publish.id } });
    expect(deployment).toMatchObject({ commitSha: "c1", status: "unconfigured" });
  });

  it("does nothing when main already has every change", async () => {
    const portfolio = await portfolioWithSandbox();
    const publish = await queuePublish(portfolio.id);
    await runner.drain(portfolio.id);

    expect(await reload(publish.id)).toMatchObject({ status: "applied", diff: expect.stringContaining("Nothing new to publish") });
    expect(sandbox.steps).not.toContain("build");
    expect(await prisma.deployment.count({ where: { operationId: publish.id } })).toBe(0);
  });

  it("rejects a draft whose production build fails, before main is touched", async () => {
    const portfolio = await portfolioWithSandbox();
    await queueEdit(portfolio.id, [{ path: "app/page.tsx", content: 'export default function Page() {\n  return <main><Slot name="sidebar" /><p>BUILD_BREAKS</p></main>;\n}\n' }]);
    await runner.drain(portfolio.id);
    const publish = await queuePublish(portfolio.id);

    await runner.drain(portfolio.id);

    const done = await reload(publish.id);
    expect(done.status).toBe("rejected");
    expect(failuresOf(done)).toEqual([
      { source: "build", file: "app/page.tsx", line: 20, code: "react/no-unescaped-entities", message: "Unescaped entity." },
    ]);
    expect(sandbox.main).toBe("base");
    expect(sandbox.staging).toBeNull();
    expect(await prisma.deployment.count({ where: { operationId: publish.id } })).toBe(0);
  });

  it("waits for an edit submitted before it, then publishes that edit", async () => {
    const portfolio = await portfolioWithSandbox();
    const edit = await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: 'export const profile = { name: "Before publish" };\n' }]);
    const publish = await queuePublish(portfolio.id);

    await runner.drain(portfolio.id);

    const [editDone, publishDone] = [await reload(edit.id), await reload(publish.id)];
    expect(editDone.finishedAt!.getTime()).toBeLessThanOrEqual(publishDone.startedAt!.getTime());
    expect(publishDone).toMatchObject({ status: "applied", commitSha: editDone.commitSha });
    expect(sandbox.main).toBe(editDone.commitSha);
  });

  it("pushes an unpushed commit to draft before publishing it", async () => {
    const portfolio = await portfolioWithSandbox();
    sandbox.pushFails = true;
    await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: 'export const profile = { name: "Unpushed" };\n' }]);
    await runner.drain(portfolio.id);
    sandbox.pushFails = false;
    const publish = await queuePublish(portfolio.id);
    sandbox.steps = [];

    await runner.drain(portfolio.id);

    expect(sandbox.steps.slice(0, 3)).toEqual(["stage", "push", "stage"]);
    expect(sandbox.remote).toBe("c1");
    expect(await reload(publish.id)).toMatchObject({ status: "applied", commitSha: "c1" });
  });

  it("stops if main has commits that draft doesn't", async () => {
    const portfolio = await portfolioWithSandbox();
    await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: 'export const profile = { name: "Draft" };\n' }]);
    await runner.drain(portfolio.id);
    sandbox.main = "someone-else";
    const publish = await queuePublish(portfolio.id);

    await runner.drain(portfolio.id);

    expect(await reload(publish.id)).toMatchObject({ status: "failed", error: expect.stringContaining("main) has changes that aren't in your draft") });
    expect(sandbox.steps).not.toContain("publish-push");
  });

  it("with hosting connected: prepares the project before main moves, then follows the deployment", async () => {
    hosting.configured = true;
    const portfolio = await portfolioWithSandbox();
    await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: 'export const profile = { name: "Hosted" };\n' }]);
    await runner.drain(portfolio.id);
    const publish = await queuePublish(portfolio.id);

    await runner.drain(portfolio.id);

    expect(await reload(publish.id)).toMatchObject({ status: "applied", commitSha: "c1" });
    expect(hosting.prepared).toEqual([`${portfolio.id}@base`]);
    const deployment = await prisma.deployment.findUniqueOrThrow({ where: { operationId: publish.id } });
    expect(deployment).toMatchObject({ status: "pending", commitSha: "c1", finishedAt: null });
    expect(tracked).toEqual([deployment.id]);
  });

  it("with hosting misconfigured: publishes nothing and says what to fix", async () => {
    const { HostingError } = await import("../hosting/hosting");
    hosting.configured = true;
    hosting.failWith = new HostingError("Vercel can't reach plinth-pages/portfolio-x: Repository not found. Install the Vercel GitHub app on the organisation.");
    const portfolio = await portfolioWithSandbox();
    await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: 'export const profile = { name: "Blocked" };\n' }]);
    await runner.drain(portfolio.id);
    const publish = await queuePublish(portfolio.id);

    await runner.drain(portfolio.id);

    expect(await reload(publish.id)).toMatchObject({ status: "failed", error: expect.stringContaining("Install the Vercel GitHub app") });
    expect(sandbox.main).toBe("base");
    expect(sandbox.steps).not.toContain("publish-push");
    expect(await prisma.deployment.count({ where: { operationId: publish.id } })).toBe(0);
    expect(tracked).toEqual([]);
  });

  it("fails without retrying when GitHub refuses the update to main", async () => {
    const portfolio = await portfolioWithSandbox();
    await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: 'export const profile = { name: "Refused" };\n' }]);
    await runner.drain(portfolio.id);
    sandbox.mainPushFails = true;
    const publish = await queuePublish(portfolio.id);

    await runner.drain(portfolio.id);

    expect(await reload(publish.id)).toMatchObject({ status: "failed", error: expect.stringContaining("GitHub refused the update to main") });
    expect(sandbox.main).toBe("base");
    expect(scheduledPushes).toEqual([]);
  });
});

describe("failures and recovery", () => {
  it("refuses to run on a workspace with changes Plinth didn't make", async () => {
    const portfolio = await portfolioWithSandbox();
    sandbox.dirty = true;
    const op = await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: "x" }]);

    await runner.drain(portfolio.id);

    expect(await reload(op.id)).toMatchObject({ status: "failed", error: expect.stringContaining("changes Plinth didn't make") });
    expect(sandbox.liveHistory).toHaveLength(1);
  });

  it("leaves draft consistent when the sandbox dies mid-check", async () => {
    const portfolio = await portfolioWithSandbox();
    sandbox.duringCheck = () => (sandbox.running = false);
    const op = await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: 'export const profile = { name: "Lost" };\n' }]);

    await runner.drain(portfolio.id);

    expect(await reload(op.id)).toMatchObject({ status: "failed", commitSha: null, error: expect.stringContaining("Nothing was applied") });
    expect(sandbox.remote).toBe("base");
    expect(woken).toEqual([portfolio.id]); // so the next visit rebuilds instead of waiting for the sweep
  });

  it("records an interrupted operation as applied when its commit landed, and as failed when it didn't", async () => {
    const portfolio = await portfolioWithSandbox();
    const landed = await prisma.operation.create({
      data: { portfolioId: portfolio.id, type: "edit", actor: "user", summary: "Landed", input: { files: [] }, status: "applying", startedAt: new Date() },
    });
    const lost = await prisma.operation.create({
      data: { portfolioId: portfolio.id, type: "edit", actor: "user", summary: "Lost", input: { files: [] }, status: "checking", startedAt: new Date() },
    });
    sandbox.commits.push({ sha: "cX", message: `Landed\n\nOperation-Id: ${landed.id}`, tree: new Map(sandbox.live) });

    await runner.drain(portfolio.id);

    expect(await reload(landed.id)).toMatchObject({ status: "applied", commitSha: "cX" });
    expect(await reload(lost.id)).toMatchObject({ status: "failed", error: expect.stringContaining("Interrupted") });
  });

  it("does nothing when the sandbox isn't running", async () => {
    const portfolio = await portfolioWithSandbox();
    await prisma.sandbox.update({ where: { portfolioId: portfolio.id }, data: { status: "paused" } });
    const op = await queueEdit(portfolio.id, [{ path: "content/profile.ts", content: "x" }]);

    expect(await runner.drain(portfolio.id)).toBe("sandbox_not_running");
    expect((await reload(op.id)).status).toBe("queued");
  });

  it("fails an operation with invalid input without touching the sandbox", async () => {
    const portfolio = await portfolioWithSandbox();
    const op = await queueEdit(portfolio.id, [{ path: ".env.local", content: "SECRET=1" }]);

    await runner.drain(portfolio.id);

    expect(await reload(op.id)).toMatchObject({ status: "failed", error: expect.stringContaining("can't be opened") });
    expect(sandbox.steps).toEqual(["discard"]);
  });
});
