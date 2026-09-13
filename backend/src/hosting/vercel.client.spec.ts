import { VercelApiError, VercelClient, explainVercelError, liveUrl, vercelProjectName } from "./vercel.client";

type Call = { url: string; method: string; body: unknown; auth: string | null };

function client(respond: (url: URL, method: string) => { status: number; body: unknown }, teamId?: string) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: URL, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ url: input.toString(), method: init.method!, body: init.body ? JSON.parse(init.body as string) : undefined, auth: headers.Authorization });
    const { status, body } = respond(input, init.method!);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { vercel: new VercelClient("vc_token", teamId, fetchImpl), calls };
}

describe("VercelClient", () => {
  it("creates a Next.js project linked to the GitHub repository when none exists", async () => {
    const { vercel, calls } = client((url, method) =>
      method === "GET" ? { status: 404, body: { error: { code: "not_found" } } } : { status: 200, body: { id: "prj_1", name: "portfolio-asha" } },
    );

    expect(await vercel.ensureProject("portfolio-asha", "plinth-pages", "portfolio-asha")).toEqual({ id: "prj_1", name: "portfolio-asha" });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET https://api.vercel.com/v9/projects/portfolio-asha",
      "POST https://api.vercel.com/v11/projects",
    ]);
    expect(calls[1].body).toEqual({ name: "portfolio-asha", framework: "nextjs", gitRepository: { type: "github", repo: "plinth-pages/portfolio-asha" } });
    expect(calls[1].auth).toBe("Bearer vc_token");
  });

  it("reuses a project already linked to the same repository", async () => {
    const { vercel, calls } = client(() => ({ status: 200, body: { id: "prj_1", name: "portfolio-asha", link: { type: "github", org: "plinth-pages", repo: "portfolio-asha" } } }));
    expect(await vercel.ensureProject("portfolio-asha", "plinth-pages", "portfolio-asha")).toEqual({ id: "prj_1", name: "portfolio-asha" });
    expect(calls).toHaveLength(1);
  });

  it("never reuses a project with the same name linked to another repository", async () => {
    const { vercel } = client(() => ({ status: 200, body: { id: "prj_x", name: "portfolio-asha", link: { type: "github", org: "someone", repo: "else" } } }));
    await expect(vercel.ensureProject("portfolio-asha", "plinth-pages", "portfolio-asha")).rejects.toMatchObject({ code: "project_linked_elsewhere" });
  });

  it("scopes every request to the team when a team id is set", async () => {
    const { vercel, calls } = client(() => ({ status: 200, body: { deployments: [] } }), "team_123");
    await vercel.findProductionDeployment("prj_1", "abc123");
    expect(calls[0].url).toBe("https://api.vercel.com/v7/deployments?projectId=prj_1&target=production&sha=abc123&limit=5&teamId=team_123");
  });

  it("finds the production deployment for a commit, ignoring canceled ones", async () => {
    const { vercel } = client(() => ({
      status: 200,
      body: {
        deployments: [
          { uid: "dpl_old", readyState: "CANCELED", url: "a.vercel.app" },
          { uid: "dpl_new", readyState: "BUILDING", url: "b.vercel.app" },
        ],
      },
    }));
    expect(await vercel.findProductionDeployment("prj_1", "abc")).toMatchObject({ id: "dpl_new", readyState: "BUILDING" });
  });

  it("deploys an exact commit of main to production", async () => {
    const { vercel, calls } = client(() => ({ status: 200, body: { id: "dpl_1", readyState: "QUEUED", url: "portfolio-asha-abc.vercel.app", alias: [] } }));
    const deployment = await vercel.createProductionDeployment({ id: "prj_1", name: "portfolio-asha" }, "plinth-pages", "portfolio-asha", "abc123");
    expect(calls[0].body).toEqual({
      name: "portfolio-asha",
      project: "prj_1",
      target: "production",
      gitSource: { type: "github", org: "plinth-pages", repo: "portfolio-asha", ref: "main", sha: "abc123" },
    });
    expect(deployment).toMatchObject({ id: "dpl_1", readyState: "QUEUED" });
  });

  it("turns API errors into VercelApiError with Vercel's code and message", async () => {
    const { vercel } = client(() => ({ status: 400, body: { error: { code: "bad_request", message: "Repository not found." } } }));
    await expect(vercel.getDeployment("dpl_1")).rejects.toMatchObject({ status: 400, code: "bad_request", message: "Repository not found." });
  });
});

describe("liveUrl", () => {
  it("prefers the shortest production alias", () => {
    expect(
      liveUrl({ id: "d", readyState: "READY", url: "portfolio-asha-9x8y.vercel.app", aliases: ["portfolio-asha-git-main-team.vercel.app", "portfolio-asha.vercel.app"], errorMessage: null }),
    ).toBe("https://portfolio-asha.vercel.app");
    expect(liveUrl({ id: "d", readyState: "READY", url: "portfolio-asha-9x8y.vercel.app", aliases: [], errorMessage: null })).toBe("https://portfolio-asha-9x8y.vercel.app");
  });
});

describe("vercelProjectName", () => {
  it("follows Vercel's naming rules", () => {
    expect(vercelProjectName("portfolio-Asha_77")).toBe("portfolio-asha_77");
    expect(vercelProjectName("a---b")).toBe("a--b");
    expect(vercelProjectName("x".repeat(120))).toHaveLength(100);
  });
});

describe("explainVercelError", () => {
  it("points at the token for auth failures and at the GitHub app for repository access", () => {
    expect(explainVercelError(new VercelApiError(403, "forbidden", "Not authorized"), "plinth-pages/p")).toMatch(/VERCEL_TOKEN and VERCEL_TEAM_ID/);
    expect(explainVercelError(new VercelApiError(400, "incorrect_git_source_info", "Could not access the repository"), "plinth-pages/p")).toMatch(
      /Install the Vercel GitHub app/,
    );
  });
});
