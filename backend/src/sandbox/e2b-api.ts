import type { Sandbox } from "e2b";
import { SandboxNotRunningError, type ExecResult, type FileEntry } from "./sandbox-driver";

/**
 * The slice of the E2B SDK the driver uses. The driver depends on this, not on the SDK, so its behaviour — which
 * arguments reach E2B, and when — is testable without network access.
 *
 * Every method that addresses a missing sandbox throws `SandboxNotRunningError(id, "gone")`.
 */
export interface E2BApi {
  create(opts: { template: string; timeoutMs: number; metadata: Record<string, string> }): Promise<E2BSandbox>;
  /** Resumes the sandbox if it is paused, and sets its timeout either way. */
  connect(sandboxId: string, opts: { timeoutMs: number }): Promise<E2BSandbox>;
  pause(sandboxId: string): Promise<void>;
  /** Idempotent: killing a missing sandbox succeeds. */
  kill(sandboxId: string): Promise<void>;
  setTimeout(sandboxId: string, timeoutMs: number): Promise<void>;
  /** Null when E2B no longer knows the sandbox. */
  getInfo(sandboxId: string): Promise<E2BInfo | null>;
}

export interface E2BInfo {
  state: "running" | "paused";
  startedAt: Date;
  endAt: Date;
}

export interface E2BSandbox {
  readonly sandboxId: string;
  /** Required in the `e2b-traffic-access-token` header of every request to a port. */
  readonly trafficAccessToken: string;
  host(port: number): string;
  /** Resolves with the exit code instead of throwing on a non-zero exit. */
  run(command: string, opts: { cwd?: string; envs?: Record<string, string>; timeoutMs: number }): Promise<ExecResult>;
  /** Starts a long-running process and returns without waiting for it. It keeps running after this client goes. */
  spawn(command: string, opts: { cwd: string; envs: Record<string, string> }): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  list(path: string): Promise<FileEntry[]>;
}

export function createE2BApi(apiKey: string): E2BApi {
  // Loaded on first use: the SDK pulls in ESM-only dependencies that Jest cannot load, and nothing but the worker's
  // driver factory needs it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require("e2b") as typeof import("e2b");
  const { Sandbox } = sdk;
  const auth = { apiKey };
  const isNotFound = (error: unknown) => error instanceof sdk.NotFoundError || error instanceof sdk.SandboxNotFoundError;
  const gone = async <T>(sandboxId: string, call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      if (isNotFound(error)) throw new SandboxNotRunningError(sandboxId, "gone");
      throw error;
    }
  };

  return {
    async create({ template, timeoutMs, metadata }) {
      const sandbox = await Sandbox.create(template, {
        ...auth,
        timeoutMs,
        metadata,
        // Gate G2: without this, anyone who learns a port URL can open the draft.
        network: { allowPublicTraffic: false },
        // E2B's default is to kill on timeout. Pausing keeps the workspace if a deadline is ever missed.
        lifecycle: { onTimeout: "pause", autoResume: false },
      });
      return wrap(sandbox, sdk);
    },
    async connect(sandboxId, { timeoutMs }) {
      return wrap(await gone(sandboxId, () => Sandbox.connect(sandboxId, { ...auth, timeoutMs })), sdk);
    },
    async pause(sandboxId) {
      await gone(sandboxId, () => Sandbox.pause(sandboxId, auth));
    },
    async kill(sandboxId) {
      await Sandbox.kill(sandboxId, auth).catch((error: unknown) => {
        if (!isNotFound(error)) throw error;
      });
    },
    async setTimeout(sandboxId, timeoutMs) {
      await gone(sandboxId, () => Sandbox.setTimeout(sandboxId, timeoutMs, auth));
    },
    async getInfo(sandboxId) {
      try {
        const info = await Sandbox.getInfo(sandboxId, auth);
        return { state: info.state, startedAt: info.startedAt, endAt: info.endAt };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
  };
}

function wrap(sandbox: Sandbox, sdk: typeof import("e2b")): E2BSandbox {
  if (!sandbox.trafficAccessToken) {
    throw new Error(`Sandbox ${sandbox.sandboxId} has public traffic enabled; it was created before previews were made private`);
  }
  return {
    sandboxId: sandbox.sandboxId,
    trafficAccessToken: sandbox.trafficAccessToken,
    host: (port) => sandbox.getHost(port),
    async run(command, { cwd, envs, timeoutMs }) {
      try {
        const result = await sandbox.commands.run(command, { cwd, envs, timeoutMs });
        return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
      } catch (error) {
        if (error instanceof sdk.CommandExitError) {
          return { exitCode: error.exitCode, stdout: error.stdout, stderr: error.stderr };
        }
        throw error;
      }
    },
    async spawn(command, { cwd, envs }) {
      // A detached shell job (`cmd &`) keeps the request open until the child exits, so use E2B's background mode
      // and drop the output stream. Disconnecting does not stop the process.
      const handle = await sandbox.commands.run(command, { cwd, envs, background: true, timeoutMs: 0 });
      await handle.disconnect();
    },
    readFile: (path) => sandbox.files.read(path),
    async writeFile(path, content) {
      await sandbox.files.write(path, content);
    },
    async list(path) {
      const entries = await sandbox.files.list(path);
      return entries.map((entry) => ({ name: entry.name, type: entry.type === sdk.FileType.DIR ? "dir" : "file" }));
    },
  };
}
