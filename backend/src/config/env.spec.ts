import { adminLogins, validateEnv } from "./env";

const worker = {
  ORCHESTRATOR_ROLE: "worker",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://127.0.0.1:6379",
  API_URL: "http://localhost:4000",
  ADMIN_URL: "http://localhost:3000",
};

describe("validateEnv", () => {
  it("names every missing variable in one message", () => {
    expect(() => validateEnv({ ORCHESTRATOR_ROLE: "worker" })).toThrow(
      /DATABASE_URL[\s\S]*REDIS_URL[\s\S]*API_URL[\s\S]*ADMIN_URL/,
    );
  });

  it("accepts a worker without sign-in secrets", () => {
    expect(validateEnv(worker).ORCHESTRATOR_ROLE).toBe("worker");
  });

  it("requires sign-in secrets for the api role", () => {
    expect(() => validateEnv({ ...worker, ORCHESTRATOR_ROLE: "api" })).toThrow(
      /SESSION_SECRET: Required when ORCHESTRATOR_ROLE=api[\s\S]*GITHUB_CLIENT_ID[\s\S]*GITHUB_CLIENT_SECRET/,
    );
  });

  it("rejects a short session secret", () => {
    expect(() =>
      validateEnv({
        ...worker,
        ORCHESTRATOR_ROLE: "api",
        SESSION_SECRET: "short",
        GITHUB_CLIENT_ID: "id",
        GITHUB_CLIENT_SECRET: "secret",
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  it("parses admin logins case-insensitively", () => {
    expect([...adminLogins({ ADMIN_GITHUB_LOGINS: " SumitVerma77, other " })]).toEqual(["sumitverma77", "other"]);
  });
});
