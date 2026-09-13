export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

/**
 * Primary or secondary rate limit. Callers should wait `retryAfterMs` and try again — this is never a
 * reason to fail a portfolio. Repository creation in particular hits the secondary limit (~80/min) in
 * bursts and returns 422 "submitted too quickly" rather than 403/429.
 */
export class GitHubRateLimitError extends GitHubApiError {
  constructor(
    status: number,
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(status, message);
    this.name = "GitHubRateLimitError";
  }
}

const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

export function toGitHubError(response: Response, body: { message?: string } | null): GitHubApiError {
  const message = body?.message ?? response.statusText;
  const retryAfter = response.headers.get("retry-after");
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");

  const isRateLimit =
    response.status === 429 ||
    (response.status === 403 && (remaining === "0" || /rate limit/i.test(message))) ||
    (response.status === 422 && /submitted too quickly/i.test(message));

  if (!isRateLimit) return new GitHubApiError(response.status, message);

  let waitMs = DEFAULT_RATE_LIMIT_WAIT_MS;
  if (retryAfter && Number.isFinite(Number(retryAfter))) waitMs = Number(retryAfter) * 1000;
  else if (remaining === "0" && reset) waitMs = Math.max(Number(reset) * 1000 - Date.now(), 1000);
  return new GitHubRateLimitError(response.status, message, waitMs);
}

/** Whether an operation that threw this error is worth retrying unchanged. */
export function isRetryableGitHubError(error: unknown): boolean {
  if (error instanceof GitHubRateLimitError) return true;
  if (error instanceof GitHubApiError) return error.status >= 500 || error.status === 401;
  // fetch rejects with TypeError on network failure.
  return error instanceof TypeError;
}
