const VERCEL_API = "https://api.vercel.com";

export type VercelReadyState = "QUEUED" | "INITIALIZING" | "BUILDING" | "READY" | "ERROR" | "CANCELED" | "BLOCKED" | "DELETED";

export interface VercelDeployment {
  id: string;
  readyState: VercelReadyState;
  /** The deployment's own URL, without protocol. */
  url: string | null;
  /** Aliases assigned to it, e.g. `<project>.vercel.app` for production. */
  aliases: string[];
  errorMessage: string | null;
}

export class VercelApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "VercelApiError";
  }
}

/**
 * The Vercel REST API calls publishing needs. Portfolio projects are linked to their GitHub repositories, so Vercel
 * builds from GitHub itself; Plinth only creates the project, asks for the production deployment of an exact commit,
 * and follows it to a live URL.
 */
export class VercelClient {
  constructor(
    private readonly token: string,
    private readonly teamId: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Finds the project for a repository, creating it on first publish. A project with the same name that is linked to
   * a different repository is never reused.
   */
  async ensureProject(name: string, org: string, repo: string): Promise<{ id: string; name: string }> {
    const existing = await this.request<{ id: string; name: string; link?: { type?: string; org?: string; repo?: string } }>(
      "GET",
      `/v9/projects/${encodeURIComponent(name)}`,
      undefined,
      [404],
    );
    if (existing) {
      const linked = existing.link?.org?.toLowerCase() === org.toLowerCase() && existing.link?.repo?.toLowerCase() === repo.toLowerCase();
      if (!linked) {
        throw new VercelApiError(409, "project_linked_elsewhere", `A Vercel project named ${name} already exists and isn't linked to ${org}/${repo}.`);
      }
      return { id: existing.id, name: existing.name };
    }

    const created = await this.request<{ id: string; name: string }>("POST", "/v11/projects", {
      name,
      framework: "nextjs",
      gitRepository: { type: "github", repo: `${org}/${repo}` },
    });
    return { id: created!.id, name: created!.name };
  }

  /** The production deployment Vercel made for this commit on its own (from the push to main), if any. */
  async findProductionDeployment(projectId: string, sha: string): Promise<VercelDeployment | null> {
    const params = new URLSearchParams({ projectId, target: "production", sha, limit: "5" });
    const json = await this.request<{ deployments: ListedDeployment[] }>("GET", `/v7/deployments?${params}`);
    const match = json!.deployments.find((deployment) => deployment.readyState !== "CANCELED" && deployment.readyState !== "DELETED");
    return match
      ? { id: match.uid, readyState: match.readyState, url: match.url ?? null, aliases: [], errorMessage: match.errorMessage ?? null }
      : null;
  }

  /** Asks Vercel to build and serve an exact commit in production. */
  async createProductionDeployment(project: { id: string; name: string }, org: string, repo: string, sha: string): Promise<VercelDeployment> {
    const json = await this.request<DeploymentJson>("POST", "/v13/deployments", {
      name: project.name,
      project: project.id,
      target: "production",
      gitSource: { type: "github", org, repo, ref: "main", sha },
    });
    return toDeployment(json!);
  }

  /**
   * The address production is served on: a verified custom domain if the owner added one, else `<project>.vercel.app`.
   * Deployment aliases also include team-scoped URLs that Vercel protects behind a login, so they aren't used.
   */
  async productionDomain(projectId: string): Promise<string | null> {
    const json = await this.request<{ domains?: { name: string; verified?: boolean; gitBranch?: string | null; redirect?: string | null }[] }>(
      "GET",
      `/v9/projects/${encodeURIComponent(projectId)}/domains`,
    );
    const domains = (json?.domains ?? []).filter((domain) => domain.verified !== false && !domain.gitBranch && !domain.redirect);
    const chosen = domains.find((domain) => !domain.name.endsWith(".vercel.app")) ?? domains.find((domain) => domain.name.endsWith(".vercel.app"));
    return chosen ? `https://${chosen.name}` : null;
  }

  /** The project's environment variables: names and ids only (sensitive values can't be read back). */
  async listEnv(projectId: string): Promise<{ id: string; key: string }[]> {
    const json = await this.request<{ envs?: { id: string; key: string }[] }>("GET", `/v9/projects/${encodeURIComponent(projectId)}/env`);
    return (json?.envs ?? []).map((env) => ({ id: env.id, key: env.key }));
  }

  /** Creates or replaces a production variable as sensitive: Vercel encrypts it and never shows it again. */
  async upsertSensitiveEnv(projectId: string, key: string, value: string): Promise<void> {
    await this.request("POST", `/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true`, { key, value, type: "sensitive", target: ["production", "preview"] });
  }

  async deleteEnv(projectId: string, envId: string): Promise<void> {
    await this.request("DELETE", `/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(envId)}`, undefined, [404]);
  }

  async getDeployment(id: string): Promise<VercelDeployment> {
    return toDeployment((await this.request<DeploymentJson>("GET", `/v13/deployments/${encodeURIComponent(id)}`))!);
  }

  private async request<T>(method: string, path: string, body?: unknown, tolerated: number[] = []): Promise<T | null> {
    const url = new URL(`${VERCEL_API}${path.split("?")[0]}`);
    new URLSearchParams(path.split("?")[1] ?? "").forEach((value, key) => url.searchParams.set(key, value));
    if (this.teamId) url.searchParams.set("teamId", this.teamId);
    const response = await this.fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (tolerated.includes(response.status)) return null;
    if (!response.ok) {
      throw new VercelApiError(response.status, json?.error?.code ?? null, json?.error?.message ?? `Vercel answered ${response.status}`);
    }
    return json as T;
  }
}

interface ListedDeployment {
  uid: string;
  readyState: VercelReadyState;
  url?: string | null;
  errorMessage?: string | null;
}

interface DeploymentJson {
  id: string;
  readyState: VercelReadyState;
  url?: string | null;
  alias?: string[];
  errorMessage?: string | null;
  readyStateReason?: string | null;
}

function toDeployment(json: DeploymentJson): VercelDeployment {
  return {
    id: json.id,
    readyState: json.readyState,
    url: json.url ?? null,
    aliases: json.alias ?? [],
    errorMessage: json.errorMessage ?? json.readyStateReason ?? null,
  };
}

/** The address to show: the shortest production alias (`<project>.vercel.app`), else the deployment's own URL. */
export function liveUrl(deployment: VercelDeployment): string | null {
  const host = [...deployment.aliases].sort((a, b) => a.length - b.length)[0] ?? deployment.url;
  return host ? `https://${host.replace(/^https?:\/\//, "")}` : null;
}

/** Vercel project names: lowercase letters, digits, `.`, `_`, `-`; at most 100 characters; no `---`. */
export function vercelProjectName(repoName: string): string {
  return repoName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-{3,}/g, "--")
    .slice(0, 100);
}

/** Turns a Vercel error into something the owner can act on. */
export function explainVercelError(error: unknown, repoFullName: string): string {
  if (!(error instanceof VercelApiError)) return error instanceof Error ? error.message : String(error);
  if (error.status === 401 || error.status === 403) {
    return `Vercel refused the token (${error.status}). Check VERCEL_TOKEN${error.status === 403 ? " and VERCEL_TEAM_ID" : ""}.`;
  }
  if (/repo|git|github|install|access/i.test(`${error.code} ${error.message}`)) {
    return `Vercel can't reach ${repoFullName}: ${error.message} Install the Vercel GitHub app on the organisation with access to all repositories, and make sure the repository is public on a Hobby plan.`;
  }
  return `Vercel: ${error.message}`;
}
