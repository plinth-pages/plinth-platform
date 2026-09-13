import { viewablePath } from "./workspace-policy";

describe("viewablePath", () => {
  it.each([
    ["app/page.tsx", "app/page.tsx"],
    ["content/./profile.ts", "content/profile.ts"],
    ["components/../app/layout.tsx", "app/layout.tsx"],
    ["plinth.json", "plinth.json"],
    [".gitignore", ".gitignore"],
    ["environment.ts", "environment.ts"],
  ])("allows %s", (input, expected) => {
    expect(viewablePath(input)).toBe(expected);
  });

  it.each([
    ".env.local",
    ".env",
    "app/.env.production",
    ".ENV.LOCAL",
    "app/../.env.local",
    "./.env.local",
    ".git/config",
    "foo/.git/HEAD",
    "node_modules/next/package.json",
    ".next/server/app/page.js",
    ".vercel/project.json",
    "certs/server.pem",
    ".npmrc",
    "../../etc/passwd",
    "/etc/passwd",
    "..",
    ".",
    "",
    "app\\..\\.env.local",
    "app/page.tsx\0.png",
  ])("refuses %j", (input) => {
    expect(() => viewablePath(input)).toThrow(/can't be opened/);
  });
});
