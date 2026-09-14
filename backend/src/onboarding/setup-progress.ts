import type { Operation, Portfolio, Sandbox } from "@prisma/client";
import type { SetupStep, SetupStatusResponse } from "@plinth-pages/shared";

const ACTIVE = new Set(["queued", "staging", "checking", "applying"]);

/**
 * The onboarding progress a new user watches, derived entirely from real state: the portfolio row, its sandbox and
 * its personalisation operation. Nothing is simulated — each step turns done when that thing has actually happened.
 */
export function setupProgress(portfolio: Portfolio, sandbox: Sandbox | null, personalise: Operation | null): SetupStatusResponse {
  const repository: SetupStep["state"] = portfolio.status === "failed" ? "failed" : portfolio.status === "ready" ? "done" : "active";
  const sandboxLive = sandbox?.status === "running";
  const personalised = personalise && !ACTIVE.has(personalise.status);

  const preview: SetupStep["state"] =
    repository !== "done" ? "pending" : sandboxLive || personalised ? "done" : sandbox?.status === "unhealthy" ? "failed" : "active";

  let details: SetupStep["state"] = "pending";
  if (repository === "done" && preview === "done") {
    if (!personalise || ACTIVE.has(personalise.status)) details = "active";
    else details = personalise.status === "applied" ? "done" : "skipped";
  }

  const steps: SetupStep[] = [
    { id: "account", label: "Signed in", state: "done" },
    { id: "site", label: "Creating your site", state: repository },
    { id: "editor", label: "Starting your editor", state: preview },
    { id: "personalise", label: "Adding your details", state: details },
  ];

  const failure =
    repository === "failed"
      ? "We couldn't finish creating your site. This is usually temporary."
      : preview === "failed"
        ? "Your editor didn't start. Trying again usually fixes it."
        : null;

  return {
    portfolioId: portfolio.id,
    steps,
    ready: details === "done" || details === "skipped",
    failure,
    retry: repository === "failed" ? "provisioning" : preview === "failed" ? "preview" : null,
    note: details === "skipped" ? "We kept the starter content — ask the co-pilot to add your details." : null,
  };
}
