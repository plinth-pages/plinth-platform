import { BadRequestException, ConflictException, Inject, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { User } from "@prisma/client";
import { z } from "zod";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { createDohFallbackFetch } from "./doh-fetch";

/** Lets tests replace calls to Supabase. */
export const SUPABASE_FETCH = Symbol("SUPABASE_FETCH");

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Tell us your name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  password: z.string().min(8, "Use at least 8 characters.").max(72, "Use at most 72 characters."),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  password: z.string().min(1, "Enter your password.").max(72),
});

/** A handle for repository names, from the email's local part. Not unique on its own; repo names add a suffix. */
export function handleFromEmail(email: string): string {
  const local = email.split("@")[0].toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return (local || "user").slice(0, 39);
}

/**
 * Email and password accounts through Supabase Auth. Accounts are created with the admin API as already confirmed,
 * so signing up signs the person straight in — no confirmation email. Supabase holds the credentials; Plinth keeps
 * only the Supabase user id and issues its own session cookie, the same as for GitHub sign-in.
 */
@Injectable()
export class SupabaseAuth {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Optional() @Inject(SUPABASE_FETCH) fetchImpl?: typeof fetch,
  ) {
    // Some networks block supabase.co at the DNS level; the fallback resolves the real address when that happens.
    this.fetchImpl = fetchImpl ?? createDohFallbackFetch();
  }

  get configured(): boolean {
    return Boolean(this.url() && this.config.get("SUPABASE_ANON_KEY", { infer: true }) && this.config.get("SUPABASE_SERVICE_ROLE_KEY", { infer: true }));
  }

  async register(body: unknown): Promise<User> {
    this.assertConfigured();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) throw fieldsError(parsed.error.issues);
    const { name, email, password } = parsed.data;

    const serviceKey = this.config.get("SUPABASE_SERVICE_ROLE_KEY", { infer: true })!;
    const created = await this.call("/auth/v1/admin/users", serviceKey, { email, password, email_confirm: true, user_metadata: { name } });
    if (!created.ok) {
      const message = String(created.body.msg ?? created.body.message ?? created.body.error_description ?? "");
      if (created.status === 422 && /already|registered|exists/i.test(message)) {
        throw new ConflictException({ statusCode: 409, message: "An account with this email already exists. Sign in instead.", fields: { email: "This email is already registered." } });
      }
      if (/password/i.test(message)) throw new BadRequestException({ statusCode: 400, message, fields: { password: message } });
      throw new ServiceUnavailableException("We couldn't create your account right now. Please try again.");
    }
    // Sign in through the normal flow, which also proves the account works end to end.
    return this.login({ email, password }, name);
  }

  async login(body: unknown, nameForNewUser?: string): Promise<User> {
    this.assertConfigured();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw fieldsError(parsed.error.issues);
    const { email, password } = parsed.data;

    const anonKey = this.config.get("SUPABASE_ANON_KEY", { infer: true })!;
    const token = await this.call("/auth/v1/token?grant_type=password", anonKey, { email, password });
    if (!token.ok) {
      if (token.status === 400 || token.status === 401) throw new UnauthorizedException("That email and password don't match.");
      throw new ServiceUnavailableException("Sign-in is unavailable right now. Please try again.");
    }
    const supabaseUser = token.body.user as { id: string; email: string; user_metadata?: { name?: string } } | undefined;
    if (!supabaseUser?.id) throw new ServiceUnavailableException("Sign-in is unavailable right now. Please try again.");

    const name = nameForNewUser ?? supabaseUser.user_metadata?.name ?? null;
    // Like ADMIN_GITHUB_LOGINS, the env list is re-applied on every sign-in.
    const admins = new Set(this.config.get("ADMIN_EMAILS", { infer: true }).split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean));
    const role = admins.has(supabaseUser.email.toLowerCase()) ? "admin" : "user";
    return this.prisma.user.upsert({
      where: { supabaseId: supabaseUser.id },
      create: { supabaseId: supabaseUser.id, email: supabaseUser.email, githubLogin: handleFromEmail(supabaseUser.email), name, role },
      update: { email: supabaseUser.email, role },
    });
  }

  private url(): string | null {
    const configured = this.config.get("SUPABASE_URL", { infer: true });
    if (configured) return configured.replace(/\/+$/, "");
    // The database already lives in Supabase: its pooler user is postgres.<project-ref>.
    try {
      const ref = new URL(this.config.get("DATABASE_URL", { infer: true })).username.split(".")[1];
      return ref ? `https://${ref}.supabase.co` : null;
    } catch {
      return null;
    }
  }

  private assertConfigured() {
    if (!this.configured) throw new ServiceUnavailableException("Email sign-in isn't set up on this server yet.");
  }

  private async call(path: string, key: string, body: unknown): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
    try {
      const response = await this.fetchImpl(`${this.url()}${path}`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: response.ok, status: response.status, body: ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
    } catch {
      return { ok: false, status: 0, body: {} };
    }
  }
}

function fieldsError(issues: z.ZodIssue[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
  return new BadRequestException({ statusCode: 400, message: Object.values(fields)[0] ?? "Check the form.", fields });
}
