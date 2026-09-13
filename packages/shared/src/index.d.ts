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
  /** Public URL of the dev server. Only answers while `status` is `running`. */
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
