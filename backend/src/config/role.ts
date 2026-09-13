export const ORCHESTRATOR_ROLES = ["api", "worker"] as const;
export type OrchestratorRole = (typeof ORCHESTRATOR_ROLES)[number];

export const ORCHESTRATOR_ROLE = Symbol("ORCHESTRATOR_ROLE");

export function resolveRole(value = process.env.ORCHESTRATOR_ROLE): OrchestratorRole {
  if (value === "api" || value === "worker") return value;
  throw new Error(
    `ORCHESTRATOR_ROLE must be "api" or "worker" (got ${JSON.stringify(value)}).`,
  );
}
