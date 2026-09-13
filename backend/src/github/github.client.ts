import { GITHUB_API, GITHUB_HEADERS, type GitHubAppAuth } from "./github-app.auth";
import { GitHubApiError, toGitHubError } from "./github.errors";

export interface RepoInfo {
  id: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  private: boolean;
  /** "owner/name" of the template this repository was generated from, if any. */
  templateFullName: string | null;
}

/** The repository operations provisioning needs. Tests substitute an in-memory implementation. */
export interface GitHubRepos {
  readonly org: string;
  readonly templateFullName: string;
  getRepo(name: string): Promise<RepoInfo | null>;
  generateFromTemplate(name: string, description: string): Promise<RepoInfo>;
  getBranchSha(repo: string, branch: string): Promise<string | null>;
  createBranch(repo: string, branch: string, sha: string): Promise<void>;
  deleteRepo(name: string): Promise<void>;
}

export const GITHUB_REPOS = Symbol("GITHUB_REPOS");

interface RepoJson {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  template_repository?: { full_name: string } | null;
}

const toRepoInfo = (json: RepoJson): RepoInfo => ({
  id: String(json.id),
  name: json.name,
  fullName: json.full_name,
  htmlUrl: json.html_url,
  private: json.private,
  templateFullName: json.template_repository?.full_name ?? null,
});

export class GitHubClient implements GitHubRepos {
  readonly templateFullName: string;

  constructor(
    private readonly auth: Pick<GitHubAppAuth, "installationToken" | "invalidate">,
    readonly org: string,
    templateRepo: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.templateFullName = `${org}/${templateRepo}`;
  }

  async getRepo(name: string): Promise<RepoInfo | null> {
    const json = await this.request<RepoJson>("GET", `/repos/${this.org}/${name}`, undefined, [404]);
    return json ? toRepoInfo(json) : null;
  }

  async generateFromTemplate(name: string, description: string): Promise<RepoInfo> {
    try {
      const json = await this.request<RepoJson>("POST", `/repos/${this.templateFullName}/generate`, {
        owner: this.org,
        name,
        description,
        private: true,
        include_all_branches: false,
      });
      return toRepoInfo(json!);
    } catch (error) {
      // A previous attempt may have created it between our existence check and this call.
      if (error instanceof GitHubApiError && error.status === 422 && /already exists/i.test(error.message)) {
        const existing = await this.getRepo(name);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async getBranchSha(repo: string, branch: string): Promise<string | null> {
    // 404: branch absent. 409: the repository is still empty while GitHub finishes generating it.
    const json = await this.request<{ object: { sha: string } }>(
      "GET",
      `/repos/${this.org}/${repo}/git/ref/heads/${branch}`,
      undefined,
      [404, 409],
    );
    return json?.object.sha ?? null;
  }

  async createBranch(repo: string, branch: string, sha: string): Promise<void> {
    try {
      await this.request("POST", `/repos/${this.org}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 422 && /already exists/i.test(error.message)) return;
      throw error;
    }
  }

  async deleteRepo(name: string): Promise<void> {
    await this.request("DELETE", `/repos/${this.org}/${name}`, undefined, [404]);
  }

  private async request<T>(method: string, path: string, body?: unknown, tolerated: number[] = []): Promise<T | null> {
    const token = await this.auth.installationToken();
    const response = await this.fetchImpl(`${GITHUB_API}${path}`, {
      method,
      headers: {
        ...GITHUB_HEADERS,
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (tolerated.includes(response.status)) return null;
    if (response.status === 204) return null;

    const json = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
    if (response.ok) return json;

    if (response.status === 401) this.auth.invalidate();
    throw toGitHubError(response, json);
  }
}
