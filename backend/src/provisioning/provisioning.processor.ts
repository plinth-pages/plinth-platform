import { Processor } from "@nestjs/bullmq";
import { LoggedWorkerHost, WORKER_DEFAULTS } from "../queue/logged-worker-host";
import { Logger } from "@nestjs/common";
import { DelayedError, UnrecoverableError, type Job } from "bullmq";
import { GitHubApiError, GitHubRateLimitError, isRetryableGitHubError } from "../github/github.errors";
import { Personaliser } from "../onboarding/personaliser";
import { ForeignRepositoryError, ProvisioningError, Provisioner } from "./provisioner";
import { ProvisioningRecovery } from "./provisioning-recovery";
import { PROVISIONING_QUEUE, type ProvisionJobData } from "./provisioning.constants";

// Concurrency and a queue-wide limiter keep bursts of sign-ups under GitHub's secondary rate limit
// (roughly 80 repository creations per minute).
@Processor(PROVISIONING_QUEUE, { ...WORKER_DEFAULTS, concurrency: 2, limiter: { max: 20, duration: 60_000 } })
export class ProvisioningProcessor extends LoggedWorkerHost {
  protected override readonly logStarts = true;
  private readonly logger = new Logger(ProvisioningProcessor.name);

  constructor(
    private readonly provisioner: Provisioner,
    private readonly recovery: ProvisioningRecovery,
    private readonly personaliser: Personaliser,
  ) {
    super();
  }

  async process(job: Job<ProvisionJobData>, token?: string): Promise<unknown> {
    if (job.name === "recover") return this.recovery.run();

    const { portfolioId } = job.data;
    try {
      const outcome = await this.provisioner.provision(portfolioId);
      if (outcome === "ready") {
        // The site works without it, so a failure here never fails provisioning.
        await this.personaliser.queueFor(portfolioId).catch((error) => this.logger.warn(`Personalisation for ${portfolioId} wasn't queued: ${describe(error)}`));
      }
      return outcome;
    } catch (error) {
      if (error instanceof GitHubRateLimitError) {
        // Waiting out a rate limit is not a failed attempt.
        this.logger.warn(`Rate limited provisioning ${portfolioId}; retrying in ${Math.round(error.retryAfterMs / 1000)}s`);
        await job.moveToDelayed(Date.now() + error.retryAfterMs, token);
        throw new DelayedError();
      }

      const reason = describe(error);
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (!isRetryable(error) || finalAttempt) {
        await this.provisioner.fail(portfolioId, reason, { deleteRepo: !(error instanceof ForeignRepositoryError) });
        throw new UnrecoverableError(reason);
      }
      this.logger.warn(`Provisioning ${portfolioId} attempt ${job.attemptsMade + 1} failed, will retry: ${reason}`);
      throw error;
    }
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ProvisioningError) return error.retryable;
  if (error instanceof GitHubApiError || error instanceof TypeError) return isRetryableGitHubError(error);
  // Unknown errors (a database blip, say) get the benefit of the doubt; attempts are bounded.
  return true;
}

function describe(error: unknown): string {
  if (error instanceof GitHubApiError) return `GitHub: ${error.message}`;
  return error instanceof Error ? error.message : "Unknown error";
}
