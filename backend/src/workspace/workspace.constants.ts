/**
 * Read-only requests the api makes of a running sandbox. The api has no E2B credentials, so it queues a job and waits
 * for the worker's answer. A separate queue from `sandbox` keeps a file click from waiting behind a cold start.
 */
export const WORKSPACE_QUEUE = "workspace";

export type WorkspaceJob =
  | { name: "tree"; data: { portfolioId: string } }
  | { name: "file"; data: { portfolioId: string; path: string } }
  | { name: "slots"; data: { portfolioId: string } }
  | { name: "check"; data: { portfolioId: string } }
  | { name: "publish-state"; data: { portfolioId: string } };

/** Failure reasons carried in the job's error message, so the api can map them to HTTP statuses. */
export const WORKSPACE_ERROR = {
  notRunning: "SANDBOX_NOT_RUNNING",
  refused: "PATH_REFUSED",
  notFound: "NOT_FOUND",
} as const;

export const MAX_VIEWABLE_BYTES = 512 * 1024;
export const MAX_TREE_ENTRIES = 5_000;
