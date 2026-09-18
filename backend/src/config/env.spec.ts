import { generateKeyPairSync } from "crypto";
import { adminLogins, validateEnv } from "./env";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
  type: "pkcs1",
  format: "pem",
}) as string;

const shared = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://127.0.0.1:6379",
  API_URL: "http://localhost:4000",
  ADMIN_URL: "http://localhost:3000",
};

const worker = {
  ...shared,
  ORCHESTRATOR_ROLE: "worker",
  GITHUB_APP_ID: "123456",
  GITHUB_APP_PRIVATE_KEY: Buffer.from(pem).toString("base64"),
  E2B_API_KEY: "e2b_test",
};

const api = {
  ...shared,
  ORCHESTRATOR_ROLE: "api",
  SESSION_SECRET: "x".repeat(32),
  GITHUB_CLIENT_ID: "id",
  GITHUB_CLIENT_SECRET: "secret",
};

describe("validateEnv", () => {
  it("names every missing variable in one message", () => {
    expect(() => validateEnv({ ORCHESTRATOR_ROLE: "worker" })).toThrow(
      /DATABASE_URL[\s\S]*REDIS_URL[\s\S]*API_URL[\s\S]*ADMIN_URL/,
    );
  });

  it("accepts a worker with App credentials and no sign-in secrets", () => {
    expect(validateEnv(worker).ORCHESTRATOR_ROLE).toBe("worker");
  });

  it("refuses to boot in production while integrations would call localhost from a visitor's browser", () => {
    expect(() => validateEnv({ ...api, NODE_ENV: "production" })).toThrow(/PUBLIC_API_URL: Required in production/);
    expect(validateEnv({ ...api, NODE_ENV: "production", PUBLIC_API_URL: "https://api.example.com" }).PUBLIC_API_URL).toBe("https://api.example.com");
    // Development is left alone: localhost is correct there.
    expect(validateEnv(api).PUBLIC_API_URL).toBe("http://localhost:4000");
  });

  it("accepts an api without App credentials", () => {
    expect(validateEnv(api).ORCHESTRATOR_ROLE).toBe("api");
  });

  it("requires sign-in secrets for the api role", () => {
    expect(() => validateEnv({ ...shared, ORCHESTRATOR_ROLE: "api" })).toThrow(
      /SESSION_SECRET: Required when ORCHESTRATOR_ROLE=api[\s\S]*GITHUB_CLIENT_ID[\s\S]*GITHUB_CLIENT_SECRET/,
    );
  });

  it("requires GitHub App credentials for the worker role", () => {
    expect(() => validateEnv({ ...shared, ORCHESTRATOR_ROLE: "worker" })).toThrow(
      /GITHUB_APP_ID: Required when ORCHESTRATOR_ROLE=worker[\s\S]*GITHUB_APP_PRIVATE_KEY/,
    );
  });

  it("rejects a private key that is not a base64 PEM", () => {
    expect(() => validateEnv({ ...worker, GITHUB_APP_PRIVATE_KEY: Buffer.from("nope").toString("base64") })).toThrow(
      /GITHUB_APP_PRIVATE_KEY: Must be the base64-encoded PEM private key/,
    );
  });

  it("defaults the organisation and template repository", () => {
    const env = validateEnv(worker);
    expect([env.GITHUB_ORG, env.GITHUB_TEMPLATE_REPO]).toEqual(["plinth-pages", "plinth-template"]);
  });

  it("rejects a short session secret", () => {
    expect(() => validateEnv({ ...api, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
  });

  it("parses admin logins case-insensitively", () => {
    expect([...adminLogins({ ADMIN_GITHUB_LOGINS: " SumitVerma77, other " })]).toEqual(["sumitverma77", "other"]);
  });

  it("defaults new portfolio repositories to private and accepts only public or private", () => {
    expect(validateEnv(worker).PORTFOLIO_REPO_VISIBILITY).toBe("private");
    expect(validateEnv({ ...worker, PORTFOLIO_REPO_VISIBILITY: "public" }).PORTFOLIO_REPO_VISIBILITY).toBe("public");
    expect(() => validateEnv({ ...worker, PORTFOLIO_REPO_VISIBILITY: "internal" })).toThrow(/PORTFOLIO_REPO_VISIBILITY/);
  });
});
