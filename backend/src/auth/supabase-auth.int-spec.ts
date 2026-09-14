/** Email accounts against real Postgres, with Supabase faked. Run with `pnpm test:int`. */
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseAuth, handleFromEmail } from "./supabase-auth";

process.loadEnvFile(".env");
jest.setTimeout(30_000);

const prisma = new PrismaService();
const values: Record<string, string> = { SUPABASE_URL: "https://ref.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
const config = { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
const emails: string[] = [];

/** A tiny Supabase: users by email, password grant. */
function fakeSupabase() {
  const users = new Map<string, { id: string; password: string; name?: string }>();
  const calls: { path: string; key: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://ref.supabase.co", "");
    const body = JSON.parse(String(init.body));
    calls.push({ path, key: (init.headers as Record<string, string>).apikey, body });
    const json = (status: number, data: object) => new Response(JSON.stringify(data), { status });
    if (path === "/auth/v1/admin/users") {
      if (users.has(body.email)) return json(422, { msg: "A user with this email address has already been registered" });
      users.set(body.email, { id: `sb-${Math.random().toString(36).slice(2)}`, password: body.password, name: body.user_metadata?.name });
      return json(200, { id: users.get(body.email)!.id });
    }
    const user = users.get(body.email);
    if (!user || user.password !== body.password) return json(400, { error_description: "Invalid login credentials" });
    return json(200, { access_token: "t", user: { id: user.id, email: body.email, user_metadata: { name: user.name } } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

it("registers a confirmed account (no email link) and signs it in, then signs in again as the same user", async () => {
  const { fetchImpl, calls } = fakeSupabase();
  const auth = new SupabaseAuth(prisma, config, fetchImpl);
  const email = `new-${Date.now()}@example.com`;
  emails.push(email);

  const user = await auth.register({ name: "Asha Menon", email: email.toUpperCase(), password: "correct horse" });
  expect(calls[0]).toMatchObject({ path: "/auth/v1/admin/users", key: "service", body: { email, email_confirm: true } });
  expect(calls[1]).toMatchObject({ path: "/auth/v1/token?grant_type=password", key: "anon" });
  expect(user).toMatchObject({ email, name: "Asha Menon", githubId: null, githubLogin: handleFromEmail(email), role: "user" });

  const again = await auth.login({ email, password: "correct horse" });
  expect(again.id).toBe(user.id);
  expect(await prisma.user.count({ where: { email } })).toBe(1);
});

it("gives clear errors: duplicate email, wrong password, weak password", async () => {
  const { fetchImpl } = fakeSupabase();
  const auth = new SupabaseAuth(prisma, config, fetchImpl);
  const email = `dup-${Date.now()}@example.com`;
  emails.push(email);
  await auth.register({ name: "A", email, password: "longenough" });

  await expect(auth.register({ name: "A", email, password: "longenough" })).rejects.toMatchObject({ response: { fields: { email: "This email is already registered." } } });
  await expect(auth.login({ email, password: "wrong-password" })).rejects.toThrow("That email and password don't match.");
  await expect(auth.register({ name: "A", email: "x@example.com", password: "short" })).rejects.toMatchObject({ response: { fields: { password: "Use at least 8 characters." } } });
});

it("reports itself unconfigured without keys", async () => {
  const bare = new SupabaseAuth(prisma, { get: () => undefined } as unknown as ConfigService<Env, true>);
  expect(bare.configured).toBe(false);
  await expect(bare.login({ email: "a@b.co", password: "x" })).rejects.toThrow(/isn't set up/);
  expect(handleFromEmail("Asha.Menon+plinth@example.com")).toBe("asha-menon-plinth");
});
