/**
 * The credential vault against real Postgres (backend/.env). Run with `pnpm test:int`.
 */
import type { ConfigService } from "@nestjs/config";
import type { Portfolio, User } from "@prisma/client";
import { randomBytes } from "crypto";
import { CatalogueIngest, integrationsDir } from "../catalogue/catalogue-ingest";
import { CatalogueService } from "../catalogue/catalogue.service";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import type { ExecOptions, SandboxDriver } from "../sandbox/sandbox-driver";
import { CredentialSync } from "./credential-sync";
import { CredentialsService } from "./credentials.service";
import { Vault } from "./vault";
import { VisitorCounterController } from "./visitor-counter.controller";

process.loadEnvFile(".env");
jest.setTimeout(60_000);

const prisma = new PrismaService();
const config = { get: () => undefined } as unknown as ConfigService<Env, true>;
const vault = new Vault(new Map([["test", randomBytes(32)]]), "test");
const createdUsers: string[] = [];
const KEY = "re_integration_test_key_9f2a";

let jobs: { name: string; data: unknown }[];
let verifyCalls: string[];
const queue = { add: async (name: string, data: unknown) => void jobs.push({ name, data }) };
const verifyFetch = (async (url: string, init: RequestInit) => {
  verifyCalls.push(url);
  const auth = (init.headers as Record<string, string>).Authorization;
  return new Response(JSON.stringify(auth === `Bearer ${KEY}` ? { data: [] } : { name: "validation_error" }), { status: auth === `Bearer ${KEY}` ? 200 : 401 });
}) as unknown as typeof fetch;

const catalogue = new CatalogueService(prisma, (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch);
const service = () => new CredentialsService(prisma, catalogue, vault, queue as never, verifyFetch);

async function owner(): Promise<{ user: User; portfolio: Portfolio }> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({ data: { githubId: `cred-${suffix}`, githubLogin: `cred-${suffix}` } });
  createdUsers.push(user.id);
  const portfolio = await prisma.portfolio.create({ data: { userId: user.id, role: "freelancer", status: "ready", repoName: `portfolio-cred-${suffix}`, repoId: "1" } });
  return { user, portfolio };
}

beforeAll(async () => {
  await prisma.$connect();
  await new CatalogueIngest(prisma, config).ingest(integrationsDir(config));
});
beforeEach(() => {
  jobs = [];
  verifyCalls = [];
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("connecting keys", () => {
  it("verifies, seals and never returns the value; then schedules a sync", async () => {
    const { user, portfolio } = await owner();
    const response = await service().connect(user, portfolio.id, "contact-form", { values: { RESEND_API_KEY: KEY, PLINTH_CONTACT_TO: "owner@example.com" } });

    expect(verifyCalls).toEqual(["https://api.resend.com/domains"]);
    expect(JSON.stringify(response)).not.toContain(KEY);
    expect(JSON.stringify(response)).not.toContain("owner@example.com");
    expect(response.integrations.find((entry) => entry.integrationId === "contact-form")?.secrets).toEqual([
      expect.objectContaining({ env: "RESEND_API_KEY", connected: true, hint: "•••• 9f2a", syncedToProduction: false }),
      expect.objectContaining({ env: "PLINTH_CONTACT_TO", connected: true, hint: "o•••@example.com" }),
    ]);

    const rows = await prisma.credential.findMany({ where: { portfolioId: portfolio.id } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.ciphertext).not.toContain(KEY);
      expect(row.integrationId).toBe("contact-form");
    }
    expect(jobs).toEqual([{ name: "sync-credentials", data: { portfolioId: portfolio.id } }]);
  });

  it("rejects an invalid key before anything is stored", async () => {
    const { user, portfolio } = await owner();
    const attempt = service().connect(user, portfolio.id, "contact-form", { values: { RESEND_API_KEY: "re_wrong_key_000000", PLINTH_CONTACT_TO: "owner@example.com" } });
    await expect(attempt).rejects.toMatchObject({ response: { fields: { RESEND_API_KEY: expect.stringMatching(/didn't accept/) } } });
    expect(await prisma.credential.count({ where: { portfolioId: portfolio.id } })).toBe(0);
    expect(jobs).toEqual([]);
  });

  it("requires every key the first time, keeps stored ones when left blank, and refuses unknown names", async () => {
    const { user, portfolio } = await owner();
    await expect(service().connect(user, portfolio.id, "contact-form", { values: { RESEND_API_KEY: KEY } })).rejects.toMatchObject({
      response: { fields: { PLINTH_CONTACT_TO: "Send messages to is required." } },
    });
    await service().connect(user, portfolio.id, "contact-form", { values: { RESEND_API_KEY: KEY, PLINTH_CONTACT_TO: "a@example.com" } });
    await service().connect(user, portfolio.id, "contact-form", { values: { RESEND_API_KEY: "", PLINTH_CONTACT_TO: "b@example.com" } });
    const env = await new CredentialSync(prisma, vault, {} as SandboxDriver).forPortfolio(portfolio.id);
    expect(env).toEqual({ RESEND_API_KEY: KEY, PLINTH_CONTACT_TO: "b@example.com" });
    await expect(service().connect(user, portfolio.id, "contact-form", { values: { OTHER_SECRET: "x" } })).rejects.toThrow(/doesn't use OTHER_SECRET/);
  });

  it("doesn't let another user touch the keys, and reports what an install still needs", async () => {
    const { portfolio } = await owner();
    const { user: stranger } = await owner();
    await expect(service().list(stranger, portfolio.id)).rejects.toThrow("Portfolio not found");
    expect(await service().missingFor(portfolio.id, "contact-form")).toEqual(["Resend API key", "Send messages to"]);
    expect(await service().missingFor(portfolio.id, "github-stats")).toEqual([]);
  });

  it("disconnects: deletes the rows and schedules the removal everywhere", async () => {
    const { user, portfolio } = await owner();
    await service().connect(user, portfolio.id, "contact-form", { values: { RESEND_API_KEY: KEY, PLINTH_CONTACT_TO: "owner@example.com" } });
    jobs = [];
    await service().disconnect(user, portfolio.id, "contact-form");
    expect(await prisma.credential.count({ where: { portfolioId: portfolio.id } })).toBe(0);
    expect(jobs).toEqual([{ name: "sync-credentials", data: { portfolioId: portfolio.id } }]);
    await expect(service().disconnect(user, portfolio.id, "contact-form")).rejects.toThrow(/no keys/);
  });
});

describe("syncing", () => {
  it("writes the preview's .env.local with the decrypted set, and removes it all after disconnecting", async () => {
    const { user, portfolio } = await owner();
    await prisma.sandbox.create({ data: { portfolioId: portfolio.id, status: "running", externalId: "sim-cred", trafficToken: "t" } });
    const written: string[] = [];
    const driver = {
      exec: async (_id: string, command: string, opts: ExecOptions) => {
        expect(command).toContain(".env.local");
        written.push(Buffer.from(opts.envs.PLINTH_ENV_B64, "base64").toString());
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    } as unknown as SandboxDriver;
    const sync = new CredentialSync(prisma, vault, driver, null);

    await service().connect(user, portfolio.id, "contact-form", { values: { RESEND_API_KEY: KEY, PLINTH_CONTACT_TO: "owner@example.com" } });
    expect(await sync.sync(portfolio.id)).toEqual({ sandbox: "written", production: "not_configured" });
    expect(written[0]).toContain(`RESEND_API_KEY="${KEY}"`);

    await service().disconnect(user, portfolio.id, "contact-form");
    await sync.sync(portfolio.id);
    expect(written[1]).not.toContain("RESEND_API_KEY");
  });

  it("upserts production variables as sensitive, deletes only the ones Plinth manages, and marks them synced", async () => {
    const { user, portfolio } = await owner();
    await prisma.portfolio.update({ where: { id: portfolio.id }, data: { vercelProjectId: "prj_test" } });
    const calls: string[] = [];
    const vercel = {
      listEnv: async () => [
        { id: "e1", key: "PLINTH_CONTACT_TO" },
        { id: "e2", key: "MY_OWN_VARIABLE" },
      ],
      upsertSensitiveEnv: async (project: string, key: string, value: string) => void calls.push(`upsert ${project} ${key} ${value === KEY ? "<key>" : "<other>"}`),
      deleteEnv: async (project: string, id: string) => void calls.push(`delete ${project} ${id}`),
    };
    const sync = new CredentialSync(prisma, vault, {} as SandboxDriver, vercel as never);

    await service().connect(user, portfolio.id, "contact-form", { values: { RESEND_API_KEY: KEY, PLINTH_CONTACT_TO: "owner@example.com" } });
    // Only the API key stays connected: the inbox variable must be removed, the user's own variable left alone.
    await prisma.credential.deleteMany({ where: { portfolioId: portfolio.id, key: "PLINTH_CONTACT_TO" } });
    expect(await sync.syncProduction(portfolio.id)).toBe("synced");
    expect(calls).toEqual(["delete prj_test e1", "upsert prj_test RESEND_API_KEY <key>"]);

    const listed = await service().list(user, portfolio.id);
    expect(listed.integrations.find((entry) => entry.integrationId === "contact-form")?.secrets[0]).toMatchObject({ syncedToProduction: true });
  });
});

describe("visitor counter endpoint", () => {
  const request = (ip: string) => ({ headers: { "x-forwarded-for": ip }, socket: {} }) as never;
  const response = () => {
    const headers: Record<string, string> = {};
    return { headers, setHeader: (k: string, v: string) => void (headers[k] = v), removeHeader: (k: string) => void delete headers[k] } as never;
  };

  it("only counts for portfolios with the integration, once per visitor, readable from any origin", async () => {
    const { portfolio } = await owner();
    const controller = new VisitorCounterController(prisma);
    await expect(controller.hit(portfolio.id, request("1.1.1.1"), response())).rejects.toThrow();

    await prisma.installedIntegration.create({ data: { portfolioId: portfolio.id, integrationId: "visitor-counter", version: "0.1.0", slot: "footer", props: {} } });
    const fresh = new VisitorCounterController(prisma);
    const res = response() as unknown as { headers: Record<string, string> };
    expect(await fresh.hit(portfolio.id, request("1.1.1.1"), res as never)).toEqual({ count: 1 });
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(await fresh.hit(portfolio.id, request("1.1.1.1"), response())).toEqual({ count: 1 });
    expect(await fresh.hit(portfolio.id, request("2.2.2.2"), response())).toEqual({ count: 2 });
    expect(await fresh.read(portfolio.id, request("3.3.3.3"), response())).toEqual({ count: 2 });
    await expect(fresh.read("not a valid id!", request("3.3.3.3"), response())).rejects.toThrow();
  });
});
