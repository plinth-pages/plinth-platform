import type { E2BApi, E2BInfo, E2BSandbox } from "./e2b-api";
import { E2BDriver, STAGING_DIR, WORKSPACE_DIR, renderEnvFile, workspacePath } from "./e2b.driver";
import {
  DRIVER_METHOD_ARITY,
  SandboxNotRunningError,
  type ExecResult,
  type PauseReason,
  type SandboxDriver,
  type SandboxDriverMethod,
} from "./sandbox-driver";

type Call = { method: string; args: unknown[] };

/** Records every call and answers like a healthy E2B account. */
class FakeE2B implements E2BApi {
  calls: Call[] = [];
  infos = new Map<string, E2BInfo>();
  /** Scripted answers for `run`, matched by substring; the first match wins. */
  runAnswers: { match: string; result: ExecResult }[] = [];
  private nextId = 1;

  sandbox(sandboxId: string): E2BSandbox {
    const record = (method: string, args: unknown[]) => this.calls.push({ method: `sandbox.${method}`, args });
    return {
      sandboxId,
      trafficAccessToken: `traffic-${sandboxId}`,
      host: (port) => `${port}-${sandboxId}.e2b.app`,
      run: async (command, opts) => {
        record("run", [command, opts]);
        const answer = this.runAnswers.find((a) => command.includes(a.match));
        if (answer) return answer.result;
        return { exitCode: 0, stdout: command.includes("curl") ? "healthy\n" : "", stderr: "" };
      },
      spawn: async (command, opts) => void record("spawn", [command, opts]),
      readFile: async (path) => (record("readFile", [path]), "contents"),
      writeFile: async (path, content) => void record("writeFile", [path, content]),
      list: async (path) => (record("list", [path]), [{ name: "app", type: "dir" as const }]),
    };
  }

  async create(opts: { template: string; timeoutMs: number; metadata: Record<string, string> }) {
    this.calls.push({ method: "create", args: [opts] });
    const id = `sbx-${this.nextId++}`;
    this.infos.set(id, { state: "running", startedAt: new Date(), endAt: new Date(Date.now() + opts.timeoutMs) });
    return this.sandbox(id);
  }
  async connect(sandboxId: string, opts: { timeoutMs: number }) {
    this.calls.push({ method: "connect", args: [sandboxId, opts] });
    const info = this.infos.get(sandboxId);
    if (!info) throw new SandboxNotRunningError(sandboxId, "gone");
    info.state = "running";
    return this.sandbox(sandboxId);
  }
  async pause(sandboxId: string) {
    this.calls.push({ method: "pause", args: [sandboxId] });
    const info = this.infos.get(sandboxId);
    if (!info) throw new SandboxNotRunningError(sandboxId, "gone");
    info.state = "paused";
  }
  async kill(sandboxId: string) {
    this.calls.push({ method: "kill", args: [sandboxId] });
    this.infos.delete(sandboxId);
  }
  async setTimeout(sandboxId: string, timeoutMs: number) {
    this.calls.push({ method: "setTimeout", args: [sandboxId, timeoutMs] });
  }
  async getInfo(sandboxId: string) {
    this.calls.push({ method: "getInfo", args: [sandboxId] });
    return this.infos.get(sandboxId) ?? null;
  }

  called(method: string) {
    return this.calls.filter((c) => c.method === method);
  }
}

function setup() {
  const api = new FakeE2B();
  const logs: string[] = [];
  const logger = { log: (m: string) => logs.push(m), warn: (m: string) => logs.push(m) };
  const driver = new E2BDriver(api, {
    template: "plinth-portfolio-test",
    logger,
    devServerReadyTimeoutMs: 50,
    pollIntervalMs: 1,
  });
  return { api, driver, logs };
}

const TOKEN = "ghs_secretInstallationToken123";
const workspace = {
  cloneUrl: "https://github.com/plinth-pages/portfolio-ada.git",
  branch: "draft",
  gitToken: TOKEN,
  env: { RESEND_API_KEY: "re_123" },
};

/**
 * Reusable: any future driver must pass the arity suite. TypeScript accepts an implementation that declares fewer
 * parameters than the interface, so a driver that silently drops `reason` or `timeoutMs` still compiles.
 */
export function describeDriverArity(name: string, make: () => SandboxDriver) {
  describe(`${name} implements every driver parameter`, () => {
    for (const method of Object.keys(DRIVER_METHOD_ARITY) as SandboxDriverMethod[]) {
      it(`${method} accepts ${DRIVER_METHOD_ARITY[method]} parameter(s)`, () => {
        const driver = make();
        expect(typeof driver[method]).toBe("function");
        expect({ method, parameters: driver[method].length }).toEqual({ method, parameters: DRIVER_METHOD_ARITY[method] });
      });
    }
  });
}

describeDriverArity("E2BDriver", () => setup().driver);

describe("the arity check", () => {
  it("catches a driver that drops a parameter the interface declares", () => {
    class ForgetfulDriver extends E2BDriver {
      // Compiles, but can no longer tell an idle pause from a rotation.
      override async pause(externalId: string): Promise<void> {
        await super.pause(externalId, "idle");
      }
    }
    const { api } = setup();
    const driver = new ForgetfulDriver(api, { template: "t", logger: console, devServerReadyTimeoutMs: 1, pollIntervalMs: 1 });
    expect(driver.pause.length).not.toBe(DRIVER_METHOD_ARITY.pause);
  });
});

describe("E2BDriver passes its parameters through", () => {
  it("create: template, timeout and the portfolio id reach E2B", async () => {
    const { api, driver } = setup();
    const created = await driver.create("portfolio-42", { timeoutMs: 123_000 });

    expect(api.called("create")[0].args[0]).toEqual({
      template: "plinth-portfolio-test",
      timeoutMs: 123_000,
      metadata: { app: "plinth", portfolioId: "portfolio-42" },
    });
    expect(created.previewUrl).toBe(`https://3000-${created.externalId}.e2b.app`);
    expect(created.accessToken).toBe(`traffic-${created.externalId}`);
    expect(created.expiresAt.getTime() - created.startedAt.getTime()).toBe(123_000);
  });

  it("resume: the timeout reaches connect, which would otherwise reset the clock to 5 minutes", async () => {
    const { api, driver } = setup();
    const { externalId } = await driver.create("p", { timeoutMs: 60_000 });
    await driver.pause(externalId, "idle");

    const resumed = await driver.resume(externalId, { timeoutMs: 420_000 });
    expect(api.called("connect").at(-1)!.args).toEqual([externalId, { timeoutMs: 420_000 }]);
    expect(resumed.expiresAt.getTime() - resumed.startedAt.getTime()).toBe(420_000);
    expect(resumed.accessToken).toBe(`traffic-${externalId}`);
  });

  it.each<PauseReason>(["idle", "rotation"])("pause: the %s reason is recorded", async (reason) => {
    const { api, driver, logs } = setup();
    const { externalId } = await driver.create("p", { timeoutMs: 60_000 });
    await driver.pause(externalId, reason);
    expect(api.called("pause")[0].args).toEqual([externalId]);
    expect(logs.join("\n")).toContain(`(${reason})`);
  });

  it("destroy: the reason is recorded and the sandbox is killed", async () => {
    const { api, driver, logs } = setup();
    const { externalId } = await driver.create("p", { timeoutMs: 60_000 });
    await driver.destroy(externalId, "idle_too_long");
    expect(api.called("kill")[0].args).toEqual([externalId]);
    expect(logs.join("\n")).toContain("(idle_too_long)");
  });

  it("extend: the timeout reaches E2B", async () => {
    const { api, driver } = setup();
    const { externalId } = await driver.create("p", { timeoutMs: 60_000 });
    await driver.extend(externalId, 240_000);
    expect(api.called("setTimeout")[0].args).toEqual([externalId, 240_000]);
  });

  it("restartDevServer: clearCache decides whether .next is removed", async () => {
    const { api, driver } = setup();
    const { externalId } = await driver.create("p", { timeoutMs: 60_000 });

    await driver.restartDevServer(externalId, { clearCache: false });
    const keep = api.called("sandbox.run").map((c) => c.args[0] as string);
    expect(keep.some((cmd) => cmd.includes("rm -rf /home/user/app/.next"))).toBe(false);

    api.calls = [];
    await driver.restartDevServer(externalId, { clearCache: true });
    const clear = api.called("sandbox.run").map((c) => c.args[0] as string);
    expect(clear.some((cmd) => cmd.includes("rm -rf /home/user/app/.next"))).toBe(true);
    expect(api.called("sandbox.spawn")).toHaveLength(1);
  });

  it("exec: cwd, envs and timeout reach the command", async () => {
    const { api, driver } = setup();
    const { externalId } = await driver.create("p", { timeoutMs: 60_000 });
    await driver.exec(externalId, "pnpm typecheck", { root: "live", cwd: "app/..", envs: { CI: "1" }, timeoutMs: 9_000 });
    expect(api.called("sandbox.run")[0].args).toEqual(["pnpm typecheck", { cwd: WORKSPACE_DIR, envs: { CI: "1" }, timeoutMs: 9_000 }]);

    api.calls = [];
    await driver.exec(externalId, "pnpm exec tsc --noEmit", { root: "staging", cwd: ".", envs: {}, timeoutMs: 1_000 });
    expect(api.called("sandbox.run")[0].args[1]).toMatchObject({ cwd: STAGING_DIR });
  });

  it("readFile, writeFile and listFiles resolve paths inside the workspace", async () => {
    const { api, driver } = setup();
    const { externalId } = await driver.create("p", { timeoutMs: 60_000 });
    await driver.readFile(externalId, { root: "live", path: "content/profile.ts" });
    await driver.writeFile(externalId, { root: "staging", path: "app/page.tsx" }, "export default 1");
    await driver.listFiles(externalId, { root: "live", path: "components" });

    expect(api.called("sandbox.readFile")[0].args).toEqual([`${WORKSPACE_DIR}/content/profile.ts`]);
    expect(api.called("sandbox.writeFile")[0].args).toEqual([`${STAGING_DIR}/app/page.tsx`, "export default 1"]);
    expect(api.called("sandbox.list")[0].args).toEqual([`${WORKSPACE_DIR}/components`]);
    await expect(driver.readFile(externalId, { root: "live", path: "../.bashrc" })).rejects.toThrow(/leaves the workspace/);
    await expect(driver.readFile(externalId, { root: "staging", path: "/etc/passwd" })).rejects.toThrow(/relative to the workspace/);
  });
});

describe("E2BDriver bootstrap", () => {
  it("clones the branch with the token only in the environment, writes .env.local, installs and starts next dev", async () => {
    const { api, driver } = setup();
    const { externalId } = await driver.create("p", { timeoutMs: 60_000 });
    await driver.bootstrap(externalId, workspace);

    const runs = api.called("sandbox.run");
    const clone = runs.find((c) => (c.args[0] as string).includes("git clone"))!;
    const [cloneCommand, cloneOpts] = clone.args as [string, { envs: Record<string, string> }];
    expect(cloneCommand).toContain("--branch 'draft'");
    expect(cloneCommand).toContain("'https://github.com/plinth-pages/portfolio-ada.git'");
    expect(cloneCommand).not.toContain(TOKEN);
    expect(Buffer.from(cloneOpts.envs.GIT_CONFIG_VALUE_0.split(" ").at(-1)!, "base64").toString()).toBe(
      `x-access-token:${TOKEN}`,
    );

    // The token appears in no other command, file or process.
    const everythingElse = JSON.stringify(api.calls.filter((c) => c !== clone));
    expect(everythingElse).not.toContain(TOKEN);

    expect(api.called("sandbox.writeFile")[0].args).toEqual([`${WORKSPACE_DIR}/.env.local`, renderEnvFile(workspace.env)]);
    expect(runs.some((c) => (c.args[0] as string).startsWith("pnpm install --frozen-lockfile --prefer-offline"))).toBe(true);
    expect(api.called("sandbox.spawn")[0].args[0]).toContain("next dev -H 0.0.0.0 -p 3000");
  });

  it("refuses a clone URL with credentials in it", async () => {
    const { driver } = setup();
    const { externalId } = await driver.create("p", { timeoutMs: 60_000 });
    await expect(
      driver.bootstrap(externalId, { ...workspace, cloneUrl: `https://x-access-token:${TOKEN}@github.com/o/r.git` }),
    ).rejects.toThrow(/no credentials/);
  });

  it("reports the failing step and never leaks the token in the message", async () => {
    const { api, driver } = setup();
    const { externalId } = await driver.create("p", { timeoutMs: 60_000 });
    api.runAnswers.push({
      match: "git clone",
      result: { exitCode: 128, stdout: "", stderr: `fatal: could not read from https://${TOKEN}@github.com` },
    });
    const error = await driver.bootstrap(externalId, workspace).catch((e: Error) => e);
    expect(error).toMatchObject({ name: "SandboxBootstrapError", step: "clone" });
    expect((error as Error).message).not.toContain(TOKEN);
    expect((error as Error).message).toContain("[redacted]");
  });

  it("fails the dev server step with the log tail when next dev exits", async () => {
    const { api, driver } = setup();
    const { externalId } = await driver.create("p", { timeoutMs: 60_000 });
    api.runAnswers.push(
      { match: "curl", result: { exitCode: 0, stdout: "unreachable\n", stderr: "" } },
      { match: "tail -n 15", result: { exitCode: 0, stdout: "Error: Cannot find module 'next'", stderr: "" } },
    );
    await expect(driver.bootstrap(externalId, workspace)).rejects.toMatchObject({
      step: "dev_server",
      message: expect.stringContaining("Cannot find module 'next'"),
    });
  });
});

describe("E2BDriver never resumes a sandbox implicitly", () => {
  it("rejects commands on a paused sandbox without connecting to it", async () => {
    const { api, driver } = setup();
    const { externalId } = await driver.create("p", { timeoutMs: 60_000 });
    await driver.pause(externalId, "idle");
    api.calls = [];

    await expect(driver.health(externalId)).rejects.toBeInstanceOf(SandboxNotRunningError);
    await expect(driver.exec(externalId, "ls", { root: "live", cwd: ".", envs: {}, timeoutMs: 1000 })).rejects.toMatchObject({
      state: "paused",
    });
    expect(api.called("connect")).toHaveLength(0);
  });

  it("reports a sandbox E2B no longer knows as gone", async () => {
    const { api, driver } = setup();
    const { externalId } = await driver.create("p", { timeoutMs: 60_000 });
    api.infos.delete(externalId);
    expect(await driver.info(externalId)).toEqual({ state: "gone", startedAt: null, expiresAt: null });
    await expect(driver.readFile(externalId, { root: "live", path: "package.json" })).rejects.toMatchObject({ state: "gone" });
  });
});

describe("workspacePath", () => {
  it.each([
    [".", WORKSPACE_DIR],
    ["app/page.tsx", `${WORKSPACE_DIR}/app/page.tsx`],
    ["content/../app/./layout.tsx", `${WORKSPACE_DIR}/app/layout.tsx`],
  ])("%s → %s", (input, expected) => expect(workspacePath(input, "live")).toBe(expected));

  it("resolves staging paths outside the live tree", () => {
    expect(workspacePath("app/page.tsx", "staging")).toBe(`${STAGING_DIR}/app/page.tsx`);
  });

  it.each(["..", "../x", "a/../../x", "/abs", "a\0b"])("rejects %j", (input) => {
    expect(() => workspacePath(input, "live")).toThrow();
  });
});
