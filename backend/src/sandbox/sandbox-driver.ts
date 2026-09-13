/**
 * The contract between Plinth and whatever runs a portfolio's preview. `E2BDriver` is the only implementation; the
 * interface exists so a self-hosted driver stays possible without touching the lifecycle above it.
 *
 * The driver knows the provider and nothing about the database: every method takes the provider's sandbox id.
 * Mapping portfolios to sandboxes, deciding when to pause, and metering belong to `SandboxLifecycle`.
 *
 * Rule for implementations: **no default parameters.** A method that declares fewer parameters than the interface
 * still compiles, and the conformance test detects that through `Function.length` — which a default value hides.
 */

export const SANDBOX_DRIVER = Symbol("SANDBOX_DRIVER");

export type PauseReason = "idle" | "rotation";
export type DestroyReason = "idle_too_long" | "rebuild" | "bootstrap_failed" | "unrecoverable" | "start_timed_out";

/** What the provider reports. `gone` means it no longer knows the sandbox. */
export type SandboxLiveState = "running" | "paused" | "gone";

/** `starting`: the dev server process is alive but not answering yet (e.g. the first compile). */
export type DevServerHealth = "healthy" | "starting" | "unreachable";

export interface CreatedSandbox {
  externalId: string;
  /** Private: answers only requests that carry `accessToken` (gate G2). Browsers reach it through the preview proxy. */
  previewUrl: string;
  accessToken: string;
  startedAt: Date;
  expiresAt: Date;
}

export interface ResumedSandbox {
  accessToken: string;
  startedAt: Date;
  expiresAt: Date;
}

export interface SandboxInfo {
  state: SandboxLiveState;
  startedAt: Date | null;
  expiresAt: Date | null;
}

export interface Workspace {
  /** Plain https clone URL. Never contains credentials. */
  cloneUrl: string;
  branch: string;
  /** Used for the clone command only; never written to the git remote, the config or disk. */
  gitToken: string;
  /** Written to `.env.local`. Empty until credentials exist (Phase 12). */
  env: Record<string, string>;
}

/**
 * `live` is the checkout `next dev` serves. `staging` is the worktree where an operation's change is made and checked
 * before it may touch the live tree (Phase 5) — outside the live tree, so the dev server never sees it.
 */
export type WorkspaceRoot = "live" | "staging";

export interface WorkspaceFile {
  root: WorkspaceRoot;
  /** Relative to the root. */
  path: string;
}

export interface ExecOptions {
  root: WorkspaceRoot;
  /** Relative to the root. */
  cwd: string;
  envs: Record<string, string>;
  timeoutMs: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface FileEntry {
  name: string;
  type: "file" | "dir";
}

export interface SandboxDriver {
  readonly provider: string;

  /** Boots an empty sandbox with public traffic disabled. The caller records `externalId` before bootstrapping, so a crash cannot leak it. */
  create(portfolioId: string, opts: { timeoutMs: number }): Promise<CreatedSandbox>;
  /** Clone, write `.env.local`, install, start the dev server, and wait until it answers. */
  bootstrap(externalId: string, workspace: Workspace): Promise<void>;
  /** Resumes a paused sandbox. `timeoutMs` is required: resuming resets the provider's clock to it. */
  resume(externalId: string, opts: { timeoutMs: number }): Promise<ResumedSandbox>;
  pause(externalId: string, reason: PauseReason): Promise<void>;
  destroy(externalId: string, reason: DestroyReason): Promise<void>;
  /** Moves the provider's auto-pause deadline to `timeoutMs` from now. */
  extend(externalId: string, timeoutMs: number): Promise<{ expiresAt: Date }>;
  info(externalId: string): Promise<SandboxInfo>;
  health(externalId: string): Promise<DevServerHealth>;
  /** Stops and starts the dev server, optionally clearing `.next`, and waits until it answers. */
  restartDevServer(externalId: string, opts: { clearCache: boolean }): Promise<void>;

  exec(externalId: string, command: string, opts: ExecOptions): Promise<ExecResult>;
  readFile(externalId: string, file: WorkspaceFile): Promise<string>;
  writeFile(externalId: string, file: WorkspaceFile, content: string): Promise<void>;
  listFiles(externalId: string, dir: WorkspaceFile): Promise<FileEntry[]>;
}

export type SandboxDriverMethod = {
  [K in keyof SandboxDriver]: SandboxDriver[K] extends (...args: never[]) => unknown ? K : never;
}[keyof SandboxDriver];

/**
 * Parameter count of every driver method, checked against the interface by the compiler: change a signature and this
 * table stops compiling until it is updated. The conformance test compares implementations against it.
 */
export const DRIVER_METHOD_ARITY: { [K in SandboxDriverMethod]: Parameters<SandboxDriver[K]>["length"] } = {
  create: 2,
  bootstrap: 2,
  resume: 2,
  pause: 2,
  destroy: 2,
  extend: 2,
  info: 1,
  health: 1,
  restartDevServer: 2,
  exec: 3,
  readFile: 2,
  writeFile: 3,
  listFiles: 2,
};

/** The sandbox is paused or gone; the operation needed it running. Never resumes it implicitly. */
export class SandboxNotRunningError extends Error {
  constructor(
    readonly externalId: string,
    readonly state: Exclude<SandboxLiveState, "running">,
  ) {
    super(`Sandbox ${externalId} is ${state}`);
    this.name = "SandboxNotRunningError";
  }
}

/** A bootstrap step failed. `detail` is the tail of the step's output, for the user and the logs. */
export class SandboxBootstrapError extends Error {
  constructor(
    readonly step: "clone" | "env" | "install" | "dev_server",
    readonly detail: string,
  ) {
    super(`${BOOTSTRAP_STEP_LABEL[step]} failed${detail ? `: ${detail}` : ""}`);
    this.name = "SandboxBootstrapError";
  }
}

const BOOTSTRAP_STEP_LABEL: Record<SandboxBootstrapError["step"], string> = {
  clone: "Cloning the repository",
  env: "Writing .env.local",
  install: "Installing dependencies",
  dev_server: "Starting the dev server",
};
