import type { Operation, Portfolio, Sandbox } from "@prisma/client";
import { Personaliser } from "./personaliser";
import { renderPersonalisation, type GitHubProfile } from "./personalisation";
import { setupProgress } from "./setup-progress";

const github: GitHubProfile = {
  login: "sumitverma77",
  name: "Sumit Verma",
  bio: "Backend engineer who likes Kafka a little too much.",
  location: "Bhopal, India",
  blog: "sumit.dev",
  email: null,
  avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
  publicRepos: 42,
  followers: 1250,
  createdAt: "2019-03-01T00:00:00Z",
  stars: 310,
  topRepos: [
    { name: "infra-pilot", description: "Infrastructure automation & CI/CD", url: "https://github.com/sumitverma77/infra-pilot", language: "TypeScript", stars: 120 },
    { name: "watchdog", description: null, url: "https://github.com/sumitverma77/watchdog", language: "Go", stars: 0 },
  ],
};

const fileOf = (files: { path: string; content: string }[], path: string) => files.find((file) => file.path === path)?.content ?? "";

describe("renderPersonalisation", () => {
  it("fills the profile from GitHub and writes the chosen theme", () => {
    const files = renderPersonalisation({ role: "developer", githubLogin: "sumitverma77", displayName: null, github, theme: { mode: "dark", accent: "#0D9488" } });
    const profile = fileOf(files, "content/profile.ts");
    expect(profile).toMatch(/^import type \{ Profile \} from "\.\/types";/);
    expect(profile).toContain('"name": "Sumit Verma"');
    expect(profile).toContain('"headline": "Backend engineer who likes Kafka a little too much."');
    expect(profile).toContain('"location": "Bhopal, India"');
    expect(profile).toContain('"url": "https://sumit.dev"');
    expect(profile).toContain('"value": "1.3k"');
    expect(profile).toContain('"href": "https://sumit.dev"');
    expect(fileOf(files, "content/theme.ts")).toContain('"mode": "dark"');
    expect(fileOf(files, "content/theme.ts")).toContain('"accent": "#0d9488"');
  });

  it("turns a developer's best repositories into projects", () => {
    const projects = fileOf(renderPersonalisation({ role: "developer", githubLogin: "sumitverma77", displayName: null, github, theme: null }), "content/projects.ts");
    expect(projects).toContain('"title": "infra-pilot"');
    expect(projects).toContain('"★ 120"');
    expect(projects).toContain("An open-source project written in Go.");
  });

  it("gives different roles visibly different starting content, and no projects outside development", () => {
    const designer = renderPersonalisation({ role: "designer", githubLogin: "asha", displayName: "Asha", github: { ...github, bio: null }, theme: null });
    const founder = renderPersonalisation({ role: "founder", githubLogin: "asha", displayName: "Asha", github: { ...github, bio: null }, theme: null });
    expect(fileOf(designer, "content/profile.ts")).toContain('"title": "Product designer"');
    expect(fileOf(founder, "content/profile.ts")).toContain('"title": "Founder"');
    expect(fileOf(designer, "content/profile.ts")).not.toEqual(fileOf(founder, "content/profile.ts"));
    expect(designer.map((file) => file.path)).toEqual(["content/profile.ts"]);
  });

  it("works without GitHub data, and can't be broken out of by hostile profile text", () => {
    const files = renderPersonalisation({
      role: "other",
      githubLogin: "x",
      displayName: null,
      github: { ...github, name: 'Evil"; import fs from "fs"; //', bio: "`${process.env.SECRET}`", topRepos: [] },
      theme: null,
    });
    const profile = fileOf(files, "content/profile.ts");
    expect(profile).toContain('"name": "Evil\\"; import fs from \\"fs\\"; //"');
    expect(profile.match(/^import /gm)).toHaveLength(1);
    expect(fileOf(renderPersonalisation({ role: "student", githubLogin: "newbie", displayName: null, github: null, theme: null }), "content/profile.ts")).toContain('"name": "newbie"');
  });
});

describe("setupProgress", () => {
  const portfolio = (status: Portfolio["status"]) => ({ id: "p1", status }) as Portfolio;
  const sandbox = (status: Sandbox["status"]) => ({ status }) as Sandbox;
  const op = (status: Operation["status"]) => ({ status }) as Operation;
  const states = (result: ReturnType<typeof setupProgress>) => result.steps.map((step) => step.state).join(",");

  it("walks through the real steps in order", () => {
    expect(states(setupProgress(portfolio("provisioning"), null, null))).toBe("done,active,pending,pending");
    expect(states(setupProgress(portfolio("ready"), sandbox("starting"), op("queued")))).toBe("done,done,active,pending");
    expect(states(setupProgress(portfolio("ready"), sandbox("running"), op("checking")))).toBe("done,done,done,active");
    const finished = setupProgress(portfolio("ready"), sandbox("running"), op("applied"));
    expect(states(finished)).toBe("done,done,done,done");
    expect(finished.ready).toBe(true);
  });

  it("offers a retry when creating the site fails", () => {
    const failed = setupProgress(portfolio("failed"), null, null);
    expect(failed).toMatchObject({ ready: false, retry: "provisioning" });
    expect(failed.failure).toBeTruthy();
  });

  it("offers a retry when the editor doesn't start", () => {
    expect(setupProgress(portfolio("ready"), sandbox("unhealthy"), op("queued"))).toMatchObject({ ready: false, retry: "preview" });
  });

  it("still opens the editor when personalisation couldn't be applied", () => {
    const skipped = setupProgress(portfolio("ready"), sandbox("running"), op("rejected"));
    expect(skipped).toMatchObject({ ready: true, retry: null });
    expect(skipped.steps[3].state).toBe("skipped");
    expect(skipped.note).toMatch(/co-pilot/);
  });
});

describe("Personaliser.githubProfile", () => {
  it("reads the public profile and ranks own, non-fork repositories by stars", async () => {
    const fake = (async (url: string) => {
      if (url.endsWith("/users/octo")) {
        return new Response(JSON.stringify({ login: "octo", name: "Octo", bio: null, location: null, blog: "", email: null, avatar_url: "a", public_repos: 3, followers: 5, created_at: "2020-01-01T00:00:00Z" }));
      }
      return new Response(
        JSON.stringify([
          { name: "small", description: "s", html_url: "u1", language: "Go", stargazers_count: 2, fork: false, archived: false },
          { name: "forked", description: "f", html_url: "u2", language: "C", stargazers_count: 900, fork: true, archived: false },
          { name: "big", description: "b", html_url: "u3", language: "TS", stargazers_count: 50, fork: false, archived: false },
          { name: "octo", description: "profile readme", html_url: "u4", language: null, stargazers_count: 99, fork: false, archived: false },
        ]),
      );
    }) as unknown as typeof fetch;
    const profile = await new Personaliser({} as never, {} as never, fake).githubProfile("octo");
    expect(profile).toMatchObject({ name: "Octo", blog: null, stars: 52 });
    expect(profile?.topRepos.map((repo) => repo.name)).toEqual(["big", "small"]);
  });

  it("returns null when GitHub can't be reached", async () => {
    const failing = (async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(await new Personaliser({} as never, {} as never, failing).githubProfile("octo")).toBeNull();
  });
});
