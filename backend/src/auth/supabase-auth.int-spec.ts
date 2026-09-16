/** Email accounts against real Postgres, with Supabase faked. Run with `pnpm test:int`. */
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { TERMS_VERSION } from "../legal/terms";
import { SupabaseAuth, handleFromEmail } from "./supabase-auth";

process.loadEnvFile(".env");
jest.setTimeout(30_000);

const prisma = new PrismaService();
const values: Record<string, string> = { SUPABASE_URL: "https://ref.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", ADMIN_EMAILS: "" };
const config = { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
const emails: string[] = [];

/** A tiny Supabase: users by email, sign-up (optionally requiring confirmation), verify, resend, password grant. */
function fakeSupabase({ confirm = false } = {}) {
  const users = new Map<string, { id: string; password: string; meta?: Record<string, unknown>; confirmed: boolean; tokenHash: string }>();
  const calls: { path: string; key: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://ref.supabase.co", "");
    const body = JSON.parse(String(init.body));
    calls.push({ path, key: (init.headers as Record<string, string>).apikey, body });
    const json = (status: number, data: object) => new Response(JSON.stringify(data), { status });
    const session = (email: string, u: { id: string; meta?: Record<string, unknown> }) => ({ access_token: "t", user: { id: u.id, email, user_metadata: u.meta ?? {} } });
    if (path === "/auth/v1/signup") {
      if (users.has(body.email)) {
        // Supabase hides existing accounts when confirmation is on.
        return confirm ? json(200, { id: "obfuscated", email: body.email }) : json(422, { msg: "User already registered" });
      }
      const created = { id: `sb-${Math.random().toString(36).slice(2)}`, password: body.password, meta: body.data, confirmed: !confirm, tokenHash: `hash-${Math.random().toString(36).slice(2)}` };
      users.set(body.email, created);
      return json(200, confirm ? { id: created.id, email: body.email, confirmation_sent_at: new Date().toISOString() } : session(body.email, created));
    }
    if (path === "/auth/v1/verify") {
      const entry = [...users.entries()].find(([, u]) => u.tokenHash === body.token_hash);
      if (!entry) return json(403, { error_code: "otp_expired", msg: "Email link is invalid or has expired" });
      entry[1].confirmed = true;
      entry[1].tokenHash = "used";
      return json(200, session(entry[0], entry[1]));
    }
    if (path === "/auth/v1/resend") return json(200, {});
    const user = users.get(body.email);
    if (!user || user.password !== body.password) return json(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
    if (!user.confirmed) return json(400, { error_code: "email_not_confirmed", msg: "Email not confirmed" });
    return json(200, session(body.email, user));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, users };
}

beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

it("signs a new account straight in when confirmation is off, then signs in again as the same user", async () => {
  const { fetchImpl, calls } = fakeSupabase();
  const auth = new SupabaseAuth(prisma, config, fetchImpl);
  const email = `new-${Date.now()}@example.com`;
  emails.push(email);

  await expect(auth.register({ name: "Asha Menon", email, password: "correct horse" })).rejects.toMatchObject({ response: { fields: { acceptTerms: expect.any(String) } } });
  const outcome = await auth.register({ name: "Asha Menon", email: email.toUpperCase(), password: "correct horse", acceptTerms: true });
  expect(calls[0]).toMatchObject({ path: "/auth/v1/signup", key: "anon", body: { email, data: { name: "Asha Menon" } } });
  if (outcome.kind !== "signed_in") throw new Error("expected a session");
  const user = outcome.user;
  expect(user).toMatchObject({ email, name: "Asha Menon", githubId: null, githubLogin: handleFromEmail(email), role: "user", termsVersion: TERMS_VERSION });
  expect(user.termsAcceptedAt).toBeInstanceOf(Date);

  const again = await auth.login({ email, password: "correct horse" });
  expect(again.id).toBe(user.id);
  expect(await prisma.user.count({ where: { email } })).toBe(1);
});

it("gives clear errors: duplicate email, wrong password, weak password", async () => {
  const { fetchImpl } = fakeSupabase();
  const auth = new SupabaseAuth(prisma, config, fetchImpl);
  const email = `dup-${Date.now()}@example.com`;
  emails.push(email);
  await auth.register({ name: "A", email, password: "longenough", acceptTerms: true });

  await expect(auth.register({ name: "A", email, password: "longenough", acceptTerms: true })).rejects.toMatchObject({ response: { fields: { email: "This email is already registered." } } });
  await expect(auth.login({ email, password: "wrong-password" })).rejects.toThrow("That email and password don't match.");
  await expect(auth.register({ name: "A", email: "x@example.com", password: "short", acceptTerms: true })).rejects.toMatchObject({ response: { fields: { password: "Use at least 8 characters." } } });
});

it("with confirmation on: no account until the link is confirmed, sign-in refused meanwhile, links single-use", async () => {
  const { fetchImpl, users } = fakeSupabase({ confirm: true });
  const auth = new SupabaseAuth(prisma, config, fetchImpl);
  const email = `confirm-${Date.now()}@example.com`;
  emails.push(email);

  expect(await auth.register({ name: "Priya", email, password: "longenough", acceptTerms: true })).toEqual({ kind: "confirm_email", email });
  expect(await prisma.user.count({ where: { email } })).toBe(0);
  await expect(auth.login({ email, password: "longenough" })).rejects.toMatchObject({ response: { code: "email_not_confirmed" } });
  await expect(auth.resendConfirmation({ email })).resolves.toBeUndefined();

  const tokenHash = users.get(email)!.tokenHash;
  const user = await auth.confirm({ token_hash: tokenHash, type: "email" });
  expect(user).toMatchObject({ email, name: "Priya" });
  await expect(auth.confirm({ token_hash: tokenHash, type: "email" })).rejects.toMatchObject({ response: { code: "link_invalid" } });
  expect((await auth.login({ email, password: "longenough" })).id).toBe(user.id);

  // Registering the same address again reveals nothing and creates nothing.
  expect(await auth.register({ name: "Someone else", email, password: "different-pass", acceptTerms: true })).toEqual({ kind: "confirm_email", email });
  expect(await prisma.user.count({ where: { email } })).toBe(1);
});

it("reports itself unconfigured without keys", async () => {
  const bare = new SupabaseAuth(prisma, { get: () => undefined } as unknown as ConfigService<Env, true>);
  expect(bare.configured).toBe(false);
  await expect(bare.login({ email: "a@b.co", password: "x" })).rejects.toThrow(/isn't set up/);
  expect(handleFromEmail("Asha.Menon+plinth@example.com")).toBe("asha-menon-plinth");
});
