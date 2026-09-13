import { createVerify, generateKeyPairSync } from "crypto";
import { GitHubAppAuth } from "./github-app.auth";
import { GitHubClient } from "./github.client";
import { GitHubApiError, GitHubRateLimitError, isRetryableGitHubError } from "./github.errors";

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown; headers?: Record<string, string> };

function fakeFetch(handler: Handler) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    const { status, body, headers = {} } = handler(url, init);
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status, headers });
  }) as typeof fetch;
  return { impl, calls };
}

const auth = { installationToken: async () => "installation-token", invalidate: jest.fn() };
const client = (handler: Handler) => {
  const f = fakeFetch(handler);
  return { gh: new GitHubClient(auth, "plinth-pages", "plinth-template", f.impl), calls: f.calls };
};

const repoJson = (name: string, template: string | null = "plinth-pages/plinth-template") => ({
  id: 42,
  name,
  full_name: `plinth-pages/${name}`,
  html_url: `https://github.com/plinth-pages/${name}`,
  private: true,
  template_repository: template ? { full_name: template } : null,
});

describe("GitHubClient", () => {
  it("returns null for a repository that does not exist", async () => {
    const { gh } = client(() => ({ status: 404, body: { message: "Not Found" } }));
    expect(await gh.getRepo("portfolio-asha")).toBeNull();
  });

  it("maps a repository and records which template it came from", async () => {
    const { gh } = client(() => ({ status: 200, body: repoJson("portfolio-asha") }));
    expect(await gh.getRepo("portfolio-asha")).toEqual({
      id: "42",
      name: "portfolio-asha",
      fullName: "plinth-pages/portfolio-asha",
      htmlUrl: "https://github.com/plinth-pages/portfolio-asha",
      private: true,
      templateFullName: "plinth-pages/plinth-template",
    });
  });

  it("generates a private repository from the template in the organisation", async () => {
    const { gh, calls } = client(() => ({ status: 201, body: repoJson("portfolio-asha") }));
    await gh.generateFromTemplate("portfolio-asha", "desc");
    expect(calls[0]).toEqual({
      url: "https://api.github.com/repos/plinth-pages/plinth-template/generate",
      method: "POST",
      body: { owner: "plinth-pages", name: "portfolio-asha", description: "desc", private: true, include_all_branches: false },
    });
  });

  it("adopts the repository when generation reports it already exists", async () => {
    const { gh } = client((url, init) =>
      init.method === "POST"
        ? { status: 422, body: { message: "Repository creation failed: name already exists on this account" } }
        : { status: 200, body: repoJson("portfolio-asha") },
    );
    expect((await gh.generateFromTemplate("portfolio-asha", "d")).fullName).toBe("plinth-pages/portfolio-asha");
  });

  it("treats an empty, still-generating repository as having no branch yet", async () => {
    const { gh } = client(() => ({ status: 409, body: { message: "Git Repository is empty." } }));
    expect(await gh.getBranchSha("portfolio-asha", "main")).toBeNull();
  });

  it("treats deleting an already-deleted repository as success", async () => {
    const { gh } = client(() => ({ status: 404, body: { message: "Not Found" } }));
    await expect(gh.deleteRepo("portfolio-asha")).resolves.toBeUndefined();
  });

  it("treats creating an existing branch as success", async () => {
    const { gh } = client(() => ({ status: 422, body: { message: "Reference already exists" } }));
    await expect(gh.createBranch("portfolio-asha", "draft", "abc")).resolves.toBeUndefined();
  });

  it("invalidates the cached token on 401", async () => {
    const { gh } = client(() => ({ status: 401, body: { message: "Bad credentials" } }));
    await expect(gh.getRepo("x")).rejects.toBeInstanceOf(GitHubApiError);
    expect(auth.invalidate).toHaveBeenCalled();
  });
});

describe("rate limits and retryability", () => {
  it("reads retry-after on a secondary rate limit", async () => {
    const { gh } = client(() => ({
      status: 403,
      body: { message: "You have exceeded a secondary rate limit" },
      headers: { "retry-after": "30" },
    }));
    const error = await gh.getRepo("x").catch((e) => e);
    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect(error.retryAfterMs).toBe(30_000);
  });

  it("treats 422 'submitted too quickly' on repository creation as a rate limit", async () => {
    const { gh } = client(() => ({ status: 422, body: { message: "Repository creation failed: was submitted too quickly" } }));
    const error = await gh.generateFromTemplate("x", "d").catch((e) => e);
    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect(error.retryAfterMs).toBe(60_000);
  });

  it("classifies server errors and network failures as retryable, and client errors as not", () => {
    expect(isRetryableGitHubError(new GitHubApiError(502, "Bad gateway"))).toBe(true);
    expect(isRetryableGitHubError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableGitHubError(new GitHubApiError(403, "Resource not accessible by integration"))).toBe(false);
    expect(isRetryableGitHubError(new GitHubApiError(422, "Validation failed"))).toBe(false);
  });
});

describe("GitHubAppAuth", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }) as string;

  it("signs an RS256 JWT GitHub will accept: issuer, backdated iat, under ten minutes", () => {
    const now = Date.UTC(2026, 8, 13, 12, 0, 0);
    const jwt = new GitHubAppAuth("123", pem, "plinth-pages").appJwt(now);
    const [header, payload, signature] = jwt.split(".");

    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims.iss).toBe("123");
    expect(claims.iat).toBe(now / 1000 - 60);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    expect(createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(publicKey, signature, "base64url")).toBe(true);
  });

  it("discovers the installation once and caches the token until near expiry", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const { impl, calls } = fakeFetch((url) =>
      url.endsWith("/orgs/plinth-pages/installation")
        ? { status: 200, body: { id: 777 } }
        : { status: 201, body: { token: "ghs_abc", expires_at: expiresAt } },
    );
    const appAuth = new GitHubAppAuth("123", pem, "plinth-pages", impl);

    expect(await appAuth.installationToken()).toBe("ghs_abc");
    expect(await appAuth.installationToken()).toBe("ghs_abc");
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.github.com/orgs/plinth-pages/installation",
      "https://api.github.com/app/installations/777/access_tokens",
    ]);
  });

  it("explains a missing installation instead of surfacing a bare 404", async () => {
    const { impl } = fakeFetch(() => ({ status: 404, body: { message: "Not Found" } }));
    await expect(new GitHubAppAuth("123", pem, "plinth-pages", impl).installationToken()).rejects.toThrow(
      /not installed on the plinth-pages organization/,
    );
  });
});
