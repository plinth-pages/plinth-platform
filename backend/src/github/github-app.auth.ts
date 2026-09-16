import { createSign } from "crypto";
import { GitHubApiError, toGitHubError } from "./github.errors";

export const GITHUB_API = "https://api.github.com";

export const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "plinth-pages",
} as const;

const base64url = (value: string) => Buffer.from(value).toString("base64url");

/**
 * GitHub App authentication: a short-lived JWT signed with the App's private key is exchanged for an
 * installation token scoped to the organisation. Tokens are cached until five minutes before expiry.
 * Nothing is persisted — a restart simply mints a new token.
 */
export class GitHubAppAuth {
  private cached?: { token: string; expiresAt: number };
  private installationId?: number;
  private identity?: { name: string; email: string };

  constructor(
    private readonly appId: string,
    private readonly privateKeyPem: string,
    private readonly org: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  appJwt(now = Date.now()): string {
    // Backdated a minute to tolerate clock drift; GitHub rejects JWTs valid for more than 10 minutes.
    const issuedAt = Math.floor(now / 1000) - 60;
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 9 * 60, iss: this.appId }));
    const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(this.privateKeyPem, "base64url");
    return `${header}.${payload}.${signature}`;
  }

  async installationToken(now = Date.now()): Promise<string> {
    if (this.cached && this.cached.expiresAt - 5 * 60_000 > now) return this.cached.token;

    const installationId = await this.resolveInstallationId();
    const response = await this.fetchImpl(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${this.appJwt(now)}` },
    });
    const body = (await response.json().catch(() => null)) as {
      token?: string;
      expires_at?: string;
      message?: string;
    } | null;
    if (!response.ok || !body?.token || !body.expires_at) throw toGitHubError(response, body);

    this.cached = { token: body.token, expiresAt: Date.parse(body.expires_at) };
    return body.token;
  }

  /**
   * The App's bot account, used as the author of commits Plinth makes in portfolio repositories — so GitHub shows
   * them as `<slug>[bot]` rather than as any person.
   */
  async botIdentity(): Promise<{ name: string; email: string }> {
    if (this.identity) return this.identity;

    const appResponse = await this.fetchImpl(`${GITHUB_API}/app`, {
      headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${this.appJwt()}` },
    });
    const app = (await appResponse.json().catch(() => null)) as { slug?: string; message?: string } | null;
    if (!appResponse.ok || !app?.slug) throw toGitHubError(appResponse, app);

    const login = `${app.slug}[bot]`;
    const userResponse = await this.fetchImpl(`${GITHUB_API}/users/${encodeURIComponent(login)}`, {
      headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${await this.installationToken()}` },
    });
    const user = (await userResponse.json().catch(() => null)) as { id?: number; message?: string } | null;
    if (!userResponse.ok || !user?.id) throw toGitHubError(userResponse, user);

    this.identity = { name: login, email: `${user.id}+${login}@users.noreply.github.com` };
    return this.identity;
  }

  /** Forget the cached token, e.g. after a 401. */
  invalidate() {
    this.cached = undefined;
  }

  private async resolveInstallationId(): Promise<number> {
    if (this.installationId) return this.installationId;

    // GITHUB_ORG may name an organization or a personal account; GitHub looks their installations up separately.
    let response: Response | undefined;
    for (const kind of ["orgs", "users"]) {
      response = await this.fetchImpl(`${GITHUB_API}/${kind}/${this.org}/installation`, {
        headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${this.appJwt()}` },
      });
      if (response.status !== 404) break;
    }
    const body = (await response!.json().catch(() => null)) as { id?: number; message?: string } | null;
    if (response!.status === 404) {
      throw new GitHubApiError(
        404,
        `The Plinth GitHub App is not installed on the ${this.org} GitHub account. Install it there on all repositories, then retry.`,
      );
    }
    if (!response!.ok || !body?.id) throw toGitHubError(response!, body);

    this.installationId = body.id;
    return body.id;
  }
}
