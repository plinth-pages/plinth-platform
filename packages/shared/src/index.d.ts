// Types only. Both apps import these with `import type`, so nothing here exists at runtime.

export type UserRole = "user" | "admin";

export interface SessionUser {
  id: string;
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
  role: UserRole;
}

export interface MeResponse {
  user: SessionUser;
}

export interface EnqueuePingResponse {
  jobId: string;
}

export type JobState =
  | "waiting"
  | "active"
  | "completed"
  | "failed"
  | "delayed"
  | "unknown";

export interface PingJobResult {
  /** Proves which process executed the job — must be a worker, never the API. */
  executedByRole: "api" | "worker";
  executedByPid: number;
  enqueuedByPid: number;
}

export interface JobStatusResponse {
  jobId: string;
  state: JobState;
  result: PingJobResult | null;
}

export interface AdminPingResponse {
  ok: true;
  role: UserRole;
}

export interface ApiError {
  statusCode: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Portfolios (Phase 2)
// ---------------------------------------------------------------------------

export type PortfolioRole =
  | "developer"
  | "designer"
  | "student"
  | "creator"
  | "freelancer"
  | "founder"
  | "researcher"
  | "other";

export type PortfolioStatus = "provisioning" | "ready" | "failed";

export interface PortfolioSummary {
  id: string;
  role: PortfolioRole;
  status: PortfolioStatus;
  repoName: string;
  /** Present once the repository exists on GitHub. */
  repoUrl: string | null;
  failureReason: string | null;
  createdAt: string;
}

export interface CreatePortfolioRequest {
  role: PortfolioRole;
}

export interface PortfolioResponse {
  portfolio: PortfolioSummary;
}

export interface PortfoliosResponse {
  portfolios: PortfolioSummary[];
}

export interface PortfolioLimitError extends ApiError {
  statusCode: 409;
  code: "PORTFOLIO_LIMIT";
  portfolioId: string;
}

/** `none`: this portfolio has never had a preview sandbox. */
export type PreviewStatus = "none" | "starting" | "running" | "paused" | "destroyed" | "unhealthy";

export interface PreviewSummary {
  status: PreviewStatus;
  /**
   * The preview link: an unguessable hostname on the preview proxy, valid for 15 minutes after the last heartbeat.
   * Null until the preview has been opened. Serves the draft only while `status` is `running`.
   */
  previewUrl: string | null;
  /** A start, restart or rebuild is queued or in progress. */
  pending: boolean;
  lastError: string | null;
  lastAccessedAt: string | null;
  /** Start of the current running stretch. */
  runStartedAt: string | null;
  /** Billed sandbox seconds, excluding the current stretch. */
  secondsUsed: number;
  coldStartMs: number | null;
  resumeMs: number | null;
  /** The sandbox pauses after this long without a heartbeat. */
  idlePauseSeconds: number;
}

export interface PreviewResponse {
  preview: PreviewSummary;
}

/** Pushed to the IDE over server-sent events. Events are hints to refetch; the REST endpoints stay authoritative. */
export type PortfolioEvent = { type: "sandbox"; status: PreviewStatus; at: string };

export type WorkspaceFileKind = "file" | "binary" | "too_large";

export interface WorkspaceTreeResponse {
  /** Workspace-relative paths, sorted. Excludes what git ignores and everything the viewer refuses to open. */
  files: string[];
  truncated: boolean;
}

export interface WorkspaceFileResponse {
  path: string;
  kind: WorkspaceFileKind;
  /** Present when `kind` is `file`. */
  content: string | null;
  size: number;
}

export interface SlotInfo {
  name: string;
  file: string;
  description: string;
  /** Renders no wrapper element. */
  bare: boolean;
  /** Integrations here wrap the page (context providers). */
  wraps: boolean;
  /** Integration ids placed in this slot, from plinth.json. */
  integrations: string[];
}

export interface SlotsResponse {
  coreVersion: string | null;
  slotsVersion: number | null;
  slots: SlotInfo[];
}

export interface ContractIssue {
  code: string;
  message: string;
  file?: string;
  line?: number;
}

export interface ContractCheckResponse {
  ok: boolean;
  issues: ContractIssue[];
  durationMs: number;
}

/** Returned with 409 when the workspace can't be read because the sandbox is not running. */
export interface SandboxNotRunningApiError extends ApiError {
  statusCode: 409;
  code: "SANDBOX_NOT_RUNNING";
}
