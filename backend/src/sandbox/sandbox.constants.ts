import type { Env } from "../config/env";

export const SANDBOX_QUEUE = "sandbox";

export type SandboxJobName = "ensure" | "restart" | "rebuild";
export interface SandboxJobData {
  portfolioId: string;
}

/** One live job per portfolio and kind: asking again while one is queued or running is a no-op. */
export const sandboxJobId = (name: SandboxJobName, portfolioId: string) => `sandbox-${name}-${portfolioId}`;

export const SANDBOX_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: true,
} as const;

export const SWEEP_EVERY_MS = 60_000;
export const SWEEP_BATCH = 50;
/** A job that finds the portfolio's sandbox lock taken waits this long and tries again. */
export const BUSY_RETRY_MS = 3_000;

/** Longer than the slowest possible start (clone 3 min + install 5 min + dev server 3 min). */
export const SANDBOX_LOCK_TTL_MS = 15 * 60_000;
/** A row still `starting` after this long, with no worker holding its lock, was abandoned. */
export const STARTING_STALE_MS = 15 * 60_000;
/** The provider timeout while bootstrapping, so a slow install is never paused halfway. */
export const BOOTSTRAP_TIMEOUT_MS = 15 * 60_000;
/**
 * The provider's own pause deadline trails Plinth's idle pause by this much. The sweep normally pauses first; the
 * deadline is the backstop if the worker is down, so an idle sandbox can never run up cost for long.
 */
export const PROVIDER_DEADLINE_SLACK_MS = 2 * 60_000;
/** Never ask the provider for a deadline past this much continuous runtime (E2B Hobby's cap is 60 minutes). */
export const MAX_CONTINUOUS_RUN_MS = 58 * 60_000;

export const DRAFT_BRANCH = "draft";

export interface SandboxTimings {
  idlePauseMs: number;
  destroyAfterPausedMs: number;
  rotateAfterMs: number;
}

export function sandboxTimings(
  env: Pick<Env, "SANDBOX_IDLE_PAUSE_MINUTES" | "SANDBOX_DESTROY_AFTER_PAUSED_HOURS" | "SANDBOX_ROTATE_AFTER_MINUTES">,
): SandboxTimings {
  return {
    idlePauseMs: env.SANDBOX_IDLE_PAUSE_MINUTES * 60_000,
    destroyAfterPausedMs: env.SANDBOX_DESTROY_AFTER_PAUSED_HOURS * 3_600_000,
    rotateAfterMs: env.SANDBOX_ROTATE_AFTER_MINUTES * 60_000,
  };
}
