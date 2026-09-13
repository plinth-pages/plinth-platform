export const PROVISIONING_QUEUE = "provisioning";

/** Until plans exist (Phase 14), every user is on the free plan. */
export const FREE_PORTFOLIO_LIMIT = 1;

/** A portfolio still provisioning after this long is assumed stuck and re-queued. */
export const STALE_PROVISIONING_MS = 10 * 60_000;
/** Re-queue at most this many per recovery tick, so a backlog can't trip GitHub's secondary rate limit. */
export const RECOVERY_BATCH = 15;
export const RECOVERY_EVERY_MS = 5 * 60_000;

/** BullMQ job ids must not contain ":". Reusing the id makes re-queueing a live job a no-op. */
export const provisionJobId = (portfolioId: string) => `provision-${portfolioId}`;

export const PROVISION_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 10_000 },
  removeOnComplete: true,
  // The outcome lives in the portfolios table; removing the job frees its id for a later retry.
  removeOnFail: true,
} as const;

export interface ProvisionJobData {
  portfolioId: string;
}
