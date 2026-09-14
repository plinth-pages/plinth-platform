import type { OperationStatus } from "@prisma/client";

export const OPERATIONS_QUEUE = "operations";

export interface OperationJobData {
  portfolioId: string;
  /** For `track-deployment` jobs. */
  deploymentId?: string;
  /** The operation that caused this job. The job runs whichever queued operation is oldest, so order is preserved. */
  operationId?: string;
}

/** One job per operation, so none is ever stranded behind a job that already finished draining. */
export const operationJobId = (operationId: string) => `op-${operationId}`;
export const pushJobId = (portfolioId: string) => `push-${portfolioId}`;
export const trackDeploymentJobId = (deploymentId: string) => `deploy-${deploymentId}`;

export const OPERATION_JOB_OPTIONS = { attempts: 5, backoff: { type: "exponential", delay: 3_000 }, removeOnComplete: true, removeOnFail: true } as const;
export const TRACK_DEPLOYMENT_JOB_OPTIONS = { attempts: 8, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true, removeOnFail: true } as const;
export const PUSH_JOB_OPTIONS = { attempts: 8, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: true, removeOnFail: true } as const;

/** Unique per request: a sync already running may have read the previous set, so a newer change always gets its own run. */
export const credentialSyncJobId = (portfolioId: string) => `sync-credentials-${portfolioId}-${Date.now()}`;
export const SYNC_CREDENTIALS_JOB_OPTIONS = { attempts: 6, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true, removeOnFail: true } as const;

export const IN_PROGRESS: OperationStatus[] = ["staging", "checking", "applying"];
export const FINISHED: OperationStatus[] = ["applied", "rejected", "reverted", "failed"];

/** A job waiting for the sandbox lock tries again after this long. */
export const OPERATION_BUSY_RETRY_MS = 2_000;

export const MAX_FILES_PER_EDIT = 20;
export const MAX_FILE_BYTES = 512 * 1024;
