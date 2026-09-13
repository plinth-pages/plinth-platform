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
