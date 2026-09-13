const MAX_PORTFOLIOS_PER_NAME = 20;

/**
 * Repository names to try for a user, in order: portfolio-<login>, portfolio-<login>-2, …
 * The name is fixed when the portfolio row is created, so every retry targets the same repository.
 */
export function repoNameCandidates(githubLogin: string): string[] {
  const slug = githubLogin
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  const base = `portfolio-${slug || "user"}`;
  return Array.from({ length: MAX_PORTFOLIOS_PER_NAME }, (_, i) => (i === 0 ? base : `${base}-${i + 1}`));
}
