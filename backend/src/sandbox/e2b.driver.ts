import { posix } from "path";
import type { E2BApi, E2BSandbox } from "./e2b-api";
import {
  SandboxBootstrapError,
  SandboxNotRunningError,
  type CreatedSandbox,
  type DestroyReason,
  type DevServerHealth,
  type ExecOptions,
  type ExecResult,
  type FileEntry,
  type PauseReason,
  type ResumedSandbox,
  type SandboxDriver,
  type SandboxInfo,
  type Workspace,
  type WorkspaceFile,
  type WorkspaceRoot,
} from "./sandbox-driver";

export const WORKSPACE_DIR = "/home/user/app";
const STATE_DIR = "/home/user/.plinth";
export const STAGING_DIR = `${STATE_DIR}/staging`;
const ROOTS: Record<WorkspaceRoot, string> = { live: WORKSPACE_DIR, staging: STAGING_DIR };
const DEV_LOG = `${STATE_DIR}/dev.log`;
export const DEV_SERVER_PORT = 3000;

// The bracket keeps these patterns from matching the shell that runs them, whose own command line contains the text.
const DEV_PROCESSES = "[n]ext dev -H|[n]ext-server";

const CLONE_TIMEOUT_MS = 3 * 60_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const SHORT_COMMAND_MS = 30_000;

export interface E2BDriverOptions {
  template: string;
  logger: { log(message: string): void; warn(message: string): void };
  devServerReadyTimeoutMs: number;
  pollIntervalMs: number;
}

export const DEFAULT_E2B_DRIVER_TIMINGS = { devServerReadyTimeoutMs: 3 * 60_000, pollIntervalMs: 1000 };

export class E2BDriver implements SandboxDriver {
  readonly provider = "e2b";

  /** Connections to sandboxes this process has seen running. Dropped on pause and destroy. */
  private readonly connected = new Map<string, E2BSandbox>();

  constructor(
    private readonly api: E2BApi,
    private readonly options: E2BDriverOptions,
  ) {}

  async create(portfolioId: string, opts: { timeoutMs: number }): Promise<CreatedSandbox> {
    const startedAt = new Date();
    const sandbox = await this.api.create({
      template: this.options.template,
      timeoutMs: opts.timeoutMs,
      metadata: { app: "plinth", portfolioId },
    });
    this.connected.set(sandbox.sandboxId, sandbox);
    return {
      externalId: sandbox.sandboxId,
      previewUrl: `https://${sandbox.host(DEV_SERVER_PORT)}`,
      accessToken: sandbox.trafficAccessToken,
      startedAt,
      expiresAt: new Date(startedAt.getTime() + opts.timeoutMs),
    };
  }

  async bootstrap(externalId: string, workspace: Workspace): Promise<void> {
    const url = new URL(workspace.cloneUrl);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("The clone URL must be a plain https URL with no credentials in it");
    }
    const sandbox = await this.running(externalId);
    const secrets = [workspace.gitToken, gitAuthHeader(workspace.gitToken)];

    const clone = await sandbox.run(
      `rm -rf ${WORKSPACE_DIR} && git clone --branch ${sh(workspace.branch)} --single-branch ${sh(workspace.cloneUrl)} ${WORKSPACE_DIR}`,
      { envs: gitAuthEnv(workspace.gitToken), timeoutMs: CLONE_TIMEOUT_MS },
    );
    if (clone.exitCode !== 0) throw new SandboxBootstrapError("clone", redact(tail(clone), secrets));

    try {
      await sandbox.writeFile(`${WORKSPACE_DIR}/.env.local`, renderEnvFile(workspace.env));
    } catch (error) {
      throw new SandboxBootstrapError("env", error instanceof Error ? error.message : "");
    }

    const install = await sandbox.run("pnpm install --frozen-lockfile --prefer-offline", {
      cwd: WORKSPACE_DIR,
      envs: { CI: "true" },
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    if (install.exitCode !== 0) throw new SandboxBootstrapError("install", tail(install));

    await this.startDevServer(sandbox);
    await this.waitForDevServer(sandbox);
  }

  async resume(externalId: string, opts: { timeoutMs: number }): Promise<ResumedSandbox> {
    const startedAt = new Date();
    const sandbox = await this.api.connect(externalId, { timeoutMs: opts.timeoutMs });
    this.connected.set(externalId, sandbox);
    return { accessToken: sandbox.trafficAccessToken, startedAt, expiresAt: new Date(startedAt.getTime() + opts.timeoutMs) };
  }

  async pause(externalId: string, reason: PauseReason): Promise<void> {
    this.options.logger.log(`Pausing sandbox ${externalId} (${reason})`);
    this.connected.delete(externalId);
    await this.api.pause(externalId);
  }

  async destroy(externalId: string, reason: DestroyReason): Promise<void> {
    this.options.logger.log(`Destroying sandbox ${externalId} (${reason})`);
    this.connected.delete(externalId);
    await this.api.kill(externalId);
  }

  async extend(externalId: string, timeoutMs: number): Promise<{ expiresAt: Date }> {
    const now = Date.now();
    await this.api.setTimeout(externalId, timeoutMs);
    return { expiresAt: new Date(now + timeoutMs) };
  }

  async info(externalId: string): Promise<SandboxInfo> {
    const info = await this.api.getInfo(externalId);
    if (!info) {
      this.connected.delete(externalId);
      return { state: "gone", startedAt: null, expiresAt: null };
    }
    if (info.state !== "running") this.connected.delete(externalId);
    return { state: info.state, startedAt: info.startedAt, expiresAt: info.endAt };
  }

  health(externalId: string): Promise<DevServerHealth> {
    return this.withSandbox(externalId, (sandbox) => this.probe(sandbox));
  }

  restartDevServer(externalId: string, opts: { clearCache: boolean }): Promise<void> {
    return this.withSandbox(externalId, async (sandbox) => {
      this.options.logger.log(`Restarting the dev server in ${externalId}${opts.clearCache ? " and clearing .next" : ""}`);
      await sandbox.run(
        [
          `pkill -TERM -f '${DEV_PROCESSES}'`,
          `for i in $(seq 1 20); do pgrep -f '${DEV_PROCESSES}' > /dev/null || break; sleep 0.25; done`,
          `pkill -KILL -f '${DEV_PROCESSES}'`,
          opts.clearCache ? `rm -rf ${WORKSPACE_DIR}/.next` : ":",
          "true",
        ].join("; "),
        { timeoutMs: SHORT_COMMAND_MS },
      );
      await this.startDevServer(sandbox);
      await this.waitForDevServer(sandbox);
    });
  }

  exec(externalId: string, command: string, opts: ExecOptions): Promise<ExecResult> {
    return this.withSandbox(externalId, (sandbox) =>
      sandbox.run(command, { cwd: workspacePath(opts.cwd, opts.root), envs: opts.envs, timeoutMs: opts.timeoutMs }),
    );
  }

  readFile(externalId: string, file: WorkspaceFile): Promise<string> {
    return this.withSandbox(externalId, (sandbox) => sandbox.readFile(workspacePath(file.path, file.root)));
  }

  writeFile(externalId: string, file: WorkspaceFile, content: string): Promise<void> {
    return this.withSandbox(externalId, (sandbox) => sandbox.writeFile(workspacePath(file.path, file.root), content));
  }

  listFiles(externalId: string, dir: WorkspaceFile): Promise<FileEntry[]> {
    return this.withSandbox(externalId, (sandbox) => sandbox.list(workspacePath(dir.path, dir.root)));
  }

  private async startDevServer(sandbox: E2BSandbox) {
    await sandbox.run(`mkdir -p ${STATE_DIR} && : > ${DEV_LOG}`, { timeoutMs: SHORT_COMMAND_MS });
    await sandbox.spawn(`exec pnpm exec next dev -H 0.0.0.0 -p ${DEV_SERVER_PORT} >> ${DEV_LOG} 2>&1`, {
      cwd: WORKSPACE_DIR,
      envs: { NEXT_TELEMETRY_DISABLED: "1" },
    });
  }

  private async waitForDevServer(sandbox: E2BSandbox) {
    const deadline = Date.now() + this.options.devServerReadyTimeoutMs;
    for (;;) {
      const health = await this.probe(sandbox);
      if (health === "healthy") return;
      if (health === "unreachable") {
        throw new SandboxBootstrapError("dev_server", `the process exited. ${await this.devLogTail(sandbox)}`.trim());
      }
      if (Date.now() >= deadline) {
        const seconds = Math.round(this.options.devServerReadyTimeoutMs / 1000);
        throw new SandboxBootstrapError("dev_server", `no response after ${seconds} s. ${await this.devLogTail(sandbox)}`.trim());
      }
      await sleep(this.options.pollIntervalMs);
    }
  }

  /** Any HTTP status counts as healthy: a 500 is the user's code failing, which restarting will not fix. */
  private async probe(sandbox: E2BSandbox): Promise<DevServerHealth> {
    const result = await sandbox.run(
      `code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:${DEV_SERVER_PORT}/); ` +
        `if [ "\${code:-000}" != "000" ]; then echo healthy; ` +
        `elif pgrep -f '[n]ext dev -H' > /dev/null; then echo starting; else echo unreachable; fi`,
      { timeoutMs: SHORT_COMMAND_MS },
    );
    const answer = result.stdout.trim();
    return answer === "healthy" || answer === "starting" ? answer : "unreachable";
  }

  private async devLogTail(sandbox: E2BSandbox): Promise<string> {
    const result = await sandbox.run(`tail -n 15 ${DEV_LOG} 2>/dev/null`, { timeoutMs: SHORT_COMMAND_MS });
    return result.stdout.trim().slice(-1500);
  }

  /**
   * Returns a connection only to a sandbox that is running. Connecting to a paused sandbox would resume it and start
   * billing, so that is left to `resume()`, which the lifecycle calls deliberately.
   */
  private async running(externalId: string): Promise<E2BSandbox> {
    const cached = this.connected.get(externalId);
    if (cached) return cached;

    const info = await this.api.getInfo(externalId);
    if (!info) throw new SandboxNotRunningError(externalId, "gone");
    if (info.state !== "running") throw new SandboxNotRunningError(externalId, "paused");

    // Connecting sets the timeout too, so carry over the deadline the sandbox already has.
    const remainingMs = Math.max(60_000, info.endAt.getTime() - Date.now());
    const sandbox = await this.api.connect(externalId, { timeoutMs: remainingMs });
    this.connected.set(externalId, sandbox);
    return sandbox;
  }

  /** A cached connection can outlive the sandbox's running state; on failure, report that rather than a network error. */
  private async withSandbox<T>(externalId: string, use: (sandbox: E2BSandbox) => Promise<T>): Promise<T> {
    const sandbox = await this.running(externalId);
    try {
      return await use(sandbox);
    } catch (error) {
      if (error instanceof SandboxBootstrapError) throw error;
      const { state } = await this.info(externalId);
      if (state !== "running") throw new SandboxNotRunningError(externalId, state);
      throw error;
    }
  }
}

/** Resolves a path relative to a workspace root. Absolute paths and paths that climb out of the root are rejected. */
export function workspacePath(relative: string, root: WorkspaceRoot): string {
  if (relative.includes("\0") || posix.isAbsolute(relative)) {
    throw new Error(`Paths must be relative to the workspace: ${JSON.stringify(relative)}`);
  }
  const normalized = posix.normalize(relative);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Path leaves the workspace: ${JSON.stringify(relative)}`);
  }
  return normalized === "." ? ROOTS[root] : `${ROOTS[root]}/${normalized}`;
}

/** Git reads an extra header from the environment, so the token reaches neither the remote URL nor `.git/config`. */
export function gitAuthEnv(token: string): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: gitAuthHeader(token),
    GIT_TERMINAL_PROMPT: "0",
  };
}

function gitAuthHeader(token: string) {
  return `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
}

export function renderEnvFile(env: Record<string, string>): string {
  const lines = Object.entries(env).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
    return `${key}=${JSON.stringify(value)}`;
  });
  return ["# Managed by Plinth. Changes here are overwritten.", ...lines, ""].join("\n");
}

function sh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function tail(result: ExecResult): string {
  return (result.stderr.trim() || result.stdout.trim()).split("\n").slice(-12).join("\n").slice(-1500);
}

function redact(text: string, secrets: string[]): string {
  return secrets.reduce((out, secret) => (secret ? out.split(secret).join("[redacted]") : out), text);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
