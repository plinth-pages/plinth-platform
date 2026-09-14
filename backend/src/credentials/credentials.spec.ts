import type { SecretSpec } from "@plinth-pages/integration-types";
import { spawnSync } from "child_process";
import { randomBytes } from "crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildScript } from "../operations/git-scripts";
import { renderEnvFile } from "../sandbox/e2b.driver";
import { verifySecret } from "./secret-verifier";
import { Vault, VaultError, secretContext, secretHint } from "./vault";

const key = () => randomBytes(32);

describe("Vault", () => {
  const vault = new Vault(new Map([["k1", key()]]), "k1");

  it("round-trips a value with a fresh IV each time", () => {
    const a = vault.seal("re_live_secret_value", "ctx");
    const b = vault.seal("re_live_secret_value", "ctx");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toContain("re_live");
    expect(vault.open(a, "ctx")).toBe("re_live_secret_value");
  });

  it("refuses a value moved to another portfolio or variable, or tampered with", () => {
    const sealed = vault.seal("secret", secretContext("p1", "RESEND_API_KEY"));
    expect(() => vault.open(sealed, secretContext("p2", "RESEND_API_KEY"))).toThrow(VaultError);
    expect(() => vault.open(sealed, secretContext("p1", "OTHER_KEY"))).toThrow(VaultError);
    const bytes = Buffer.from(sealed.ciphertext, "base64");
    bytes[0] ^= 0xff;
    expect(() => vault.open({ ...sealed, ciphertext: bytes.toString("base64") }, secretContext("p1", "RESEND_API_KEY"))).toThrow(VaultError);
  });

  it("rotates keys: new values use the active key, old ones still open with theirs", () => {
    const oldKey = key();
    const before = new Vault(new Map([["old", oldKey]]), "old").seal("value", "ctx");
    const rotated = new Vault(new Map([["new", key()], ["old", oldKey]]), "new");
    expect(rotated.open(before, "ctx")).toBe("value");
    expect(rotated.seal("value", "ctx").keyId).toBe("new");
    expect(() => new Vault(new Map([["new", key()]]), "new").open(before, "ctx")).toThrow(/isn't configured/);
  });

  it("parses CREDENTIALS_KEYS and rejects bad configuration", () => {
    const k = key().toString("base64");
    expect(Vault.fromConfig(undefined, undefined)).toBeNull();
    expect(Vault.fromConfig(`a:${k},b:${k}`, "b")!.seal("x", "c").keyId).toBe("b");
    expect(Vault.fromConfig(`a:${k}`, undefined)!.seal("x", "c").keyId).toBe("a");
    expect(() => Vault.fromConfig("nokey", undefined)).toThrow(VaultError);
    expect(() => Vault.fromConfig(`a:${randomBytes(16).toString("base64")}`, undefined)).toThrow(/32 bytes/);
    expect(() => Vault.fromConfig(`a:${k}`, "missing")).toThrow(/active key/);
  });

  it("shows only safe hints", () => {
    expect(secretHint("re_abcdefgh1234", "api_key")).toBe("•••• 1234");
    expect(secretHint("short", "api_key")).toBe("••••");
    expect(secretHint("sumit@example.com", "email")).toBe("s•••@example.com");
  });
});

describe("verifySecret", () => {
  const resend: SecretSpec = { env: "RESEND_API_KEY", label: "Resend API key", kind: "api_key", provider: "resend", required: true };
  const inbox: SecretSpec = { env: "PLINTH_CONTACT_TO", label: "Send messages to", kind: "email", provider: "none", required: true };
  const answer = (status: number, body: object = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("accepts a Resend key that lists domains, or one restricted to sending", async () => {
    expect(await verifySecret(resend, "re_valid_key_123", answer(200, { data: [] }))).toEqual({ ok: true });
    expect(await verifySecret(resend, "re_sending_only_1", answer(401, { name: "restricted_api_key" }))).toEqual({ ok: true });
  });

  it("rejects a key Resend refuses, and anything that isn't shaped like one, without saving", async () => {
    expect(await verifySecret(resend, "re_deleted_key_12", answer(401, { name: "validation_error" }))).toMatchObject({ ok: false, message: expect.stringMatching(/didn't accept/) });
    expect(await verifySecret(resend, "sk_live_nope", answer(200))).toMatchObject({ ok: false, message: expect.stringMatching(/start with re_/) });
    expect(await verifySecret(resend, "re_valid_key_123", (async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).toMatchObject({ ok: false, message: expect.stringMatching(/couldn't be reached/) });
  });

  it("checks the format of other values", async () => {
    expect(await verifySecret(inbox, "me@example.com")).toEqual({ ok: true });
    expect(await verifySecret(inbox, "not an email")).toMatchObject({ ok: false });
    expect(await verifySecret(inbox, "a@b.co\nBcc: x@y.z")).toMatchObject({ ok: false, message: expect.stringMatching(/line breaks/) });
    expect(await verifySecret(inbox, "   ")).toMatchObject({ ok: false, message: expect.stringMatching(/required/) });
  });
});

describe("renderEnvFile", () => {
  it("quotes values and escapes $ so Next doesn't expand it", () => {
    expect(renderEnvFile({ RESEND_API_KEY: 're_a$HOME"b' })).toBe('# Managed by Plinth. Changes here are overwritten.\nRESEND_API_KEY="re_a\\$HOME\\"b"\n');
    expect(() => renderEnvFile({ "BAD NAME": "x" })).toThrow();
  });
});

// Runs the real publish build script with a fake `pnpm`, to prove the secret reaches the build and a leak is caught.
const bash = spawnSync("bash", ["-c", "command -v base64 grep"], { encoding: "utf8" });
(bash.status === 0 ? describe : describe.skip)("publish build secret scan", () => {
  let dir: string;
  const run = (env: Record<string, string>, leak: boolean) => {
    writeFileSync(
      join(dir, "bin", "pnpm"),
      [
        "#!/usr/bin/env bash",
        'if [ "$2" = "plinth" ]; then echo "{}"; exit 0; fi',
        'if [ "$2" = "next" ]; then',
        "  mkdir -p .next/static/chunks .next/server/app",
        '  test -f .env.production.local && echo "ENV_PRESENT" > .next/build-saw-env',
        leak ? '  sed -n "s/^RESEND_API_KEY=\\"\\(.*\\)\\"$/const k=\\"\\1\\";/p" .env.production.local > .next/static/chunks/main.js' : '  echo "const ok=1;" > .next/static/chunks/main.js',
        "fi",
        "exit 0",
      ].join("\n"),
    );
    chmodSync(join(dir, "bin", "pnpm"), 0o755);
    const script = buildScript().replace(/\/home\/user\/\.plinth/g, join(dir, "state").replace(/\\/g, "/"));
    return spawnSync("bash", ["-c", script], { cwd: join(dir, "work"), encoding: "utf8", env: { ...process.env, ...env, PATH: `${join(dir, "bin")}:${process.env.PATH}` } });
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "plinth-scan-"));
    for (const sub of ["bin", "state", "work"]) mkdirSync(join(dir, sub));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const secret = "re_super_secret_value_42";
  const env = {
    PLINTH_ENV_B64: Buffer.from(renderEnvFile({ RESEND_API_KEY: secret })).toString("base64"),
    PLINTH_PROBES_B64: Buffer.from(`RESEND_API_KEY=${secret}\0`).toString("base64"),
  };

  it("gives the build the secrets, removes them afterwards, and reports no leak for a clean bundle", () => {
    const result = run(env, false);
    expect(result.stdout).toMatch(/^PLINTH_SECRET_LEAK=$/m);
    expect(readFileSync(join(dir, "work", ".next", "build-saw-env"), "utf8")).toContain("ENV_PRESENT");
    expect(existsSync(join(dir, "work", ".env.production.local"))).toBe(false);
    expect(result.stdout).not.toContain(secret);
  });

  it("names the variable whose value reached the browser bundle", () => {
    const result = run(env, true);
    expect(result.stdout).toMatch(/^PLINTH_SECRET_LEAK=RESEND_API_KEY$/m);
    expect(result.stdout).not.toContain(secret);
  });
});
