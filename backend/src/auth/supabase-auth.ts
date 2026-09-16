import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { User } from "@prisma/client";
import { z } from "zod";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { TERMS_VERSION } from "../legal/terms";
import { createDohFallbackFetch } from "./doh-fetch";

/** Lets tests replace calls to Supabase. */
export const SUPABASE_FETCH = Symbol("SUPABASE_FETCH");

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Tell us your name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  password: z.string().min(8, "Use at least 8 characters.").max(72, "Use at most 72 characters."),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "Please accept the Terms and Privacy Policy to continue." }) }),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  password: z.string().min(1, "Enter your password.").max(72),
});

export const resendSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
});
/** The link in Supabase's "Confirm sign up" email: `{{ .SiteURL }}/verify-email?token_hash={{ .TokenHash }}&type=email`. */
export const confirmSchema = z.object({
  token_hash: z.string().min(10).max(200),
  type: z.enum(["email", "signup"]).default("email"),
});

/** Registering either signs the person in (confirmation off) or leaves them to confirm their email first. */
export type RegisterOutcome = { kind: "signed_in"; user: User } | { kind: "confirm_email"; email: string };

interface SupabaseUser {
  id: string;
  email: string;
  /** Consent is stored with the Supabase user at sign-up, so it survives until the Plinth account is created. */
  user_metadata?: { name?: string; terms_version?: string; terms_accepted_at?: string };
}

/** A handle for repository names, from the email's local part. Not unique on its own; repo names add a suffix. */
export function handleFromEmail(email: string): string {
  const local = email.split("@")[0].toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return (local || "user").slice(0, 39);
}

/**
 * Email and password accounts through Supabase Auth. Supabase holds the credentials and — when "Confirm email" is on —
 * sends the confirmation email itself, through the project's SMTP. Plinth creates its own user only once Supabase
 * returns a session (at sign-up when confirmation is off, otherwise when the link is confirmed), keeps just the
 * Supabase user id, and issues its own session cookie, the same as for GitHub sign-in.
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

  async register(body: unknown): Promise<RegisterOutcome> {
    this.assertConfigured();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) throw fieldsError(parsed.error.issues);
    const { name, email, password } = parsed.data;

    const signup = await this.call("/auth/v1/signup", this.anonKey(), {
      email,
      password,
      data: { name, terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString() },
    });
    if (!signup.ok) {
      const message = errorMessage(signup.body);
      if (signup.status === 422 && /already|registered|exists/i.test(message)) {
        throw new ConflictException({ statusCode: 409, message: "An account with this email already exists. Sign in instead.", fields: { email: "This email is already registered." } });
      }
      if (/password/i.test(message)) throw new BadRequestException({ statusCode: 400, message, fields: { password: message } });
      if (signup.status === 429) throw new ServiceUnavailableException("Too many sign-ups just now. Please try again in a minute.");
      if (/sending|email/i.test(message)) throw new ServiceUnavailableException("We couldn't send the confirmation email. Please try again shortly.");
      throw new ServiceUnavailableException("We couldn't create your account right now. Please try again.");
    }

    // With "Confirm email" off, Supabase returns a session straight away.
    const sessionUser = signup.body.access_token ? (signup.body.user as SupabaseUser | undefined) : undefined;
    if (sessionUser?.id) return { kind: "signed_in", user: await this.upsert(sessionUser, name) };
    // Otherwise it has emailed a link. For an address that is already registered Supabase answers the same way and
    // sends nothing, so nobody can use this form to find out who has an account.
    return { kind: "confirm_email", email };
  }

  /** Exchanges the emailed link for a session: the account is confirmed and signed in. */
  async confirm(body: unknown): Promise<User> {
    this.assertConfigured();
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("That confirmation link is incomplete. Open it again from the email.");

    const verified = await this.call("/auth/v1/verify", this.anonKey(), parsed.data);
    if (!verified.ok) {
      if (verified.status >= 400 && verified.status < 500) {
        throw new BadRequestException({ statusCode: 400, code: "link_invalid", message: "This confirmation link has expired or was already used. Sign in, or request a new link." });
      }
      throw new ServiceUnavailableException("We couldn't confirm your email right now. Please try again.");
    }
    const user = verified.body.user as SupabaseUser | undefined;
    if (!user?.id) throw new ServiceUnavailableException("We couldn't confirm your email right now. Please try again.");
    return this.upsert(user);
  }

  /** Sends the confirmation email again. Never says whether the address has an account. */
  async resendConfirmation(body: unknown): Promise<void> {
    this.assertConfigured();
    const parsed = resendSchema.safeParse(body);
    if (!parsed.success) throw fieldsError(parsed.error.issues);
    const sent = await this.call("/auth/v1/resend", this.anonKey(), { type: "signup", email: parsed.data.email });
    if (sent.status === 429) throw new ServiceUnavailableException("Please wait a minute before asking for another email.");
  }

  async login(body: unknown, nameForNewUser?: string): Promise<User> {
    this.assertConfigured();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw fieldsError(parsed.error.issues);
    const { email, password } = parsed.data;

    const token = await this.call("/auth/v1/token?grant_type=password", this.anonKey(), { email, password });
    if (!token.ok) {
      if (token.body.error_code === "email_not_confirmed" || /not confirmed/i.test(errorMessage(token.body))) {
        throw new ForbiddenException({ statusCode: 403, code: "email_not_confirmed", message: "Confirm your email first — we sent you a link when you signed up." });
      }
      if (token.status === 400 || token.status === 401) throw new UnauthorizedException("That email and password don't match.");
      throw new ServiceUnavailableException("Sign-in is unavailable right now. Please try again.");
    }
    const supabaseUser = token.body.user as SupabaseUser | undefined;
    if (!supabaseUser?.id) throw new ServiceUnavailableException("Sign-in is unavailable right now. Please try again.");
    return this.upsert(supabaseUser, nameForNewUser);
  }

  private upsert(supabaseUser: SupabaseUser, nameForNewUser?: string): Promise<User> {
    const name = nameForNewUser ?? supabaseUser.user_metadata?.name ?? null;
    const metadata = supabaseUser.user_metadata;
    const consent =
      metadata?.terms_version && metadata.terms_accepted_at
        ? { termsVersion: metadata.terms_version, termsAcceptedAt: new Date(metadata.terms_accepted_at) }
        : {};
    // Like ADMIN_GITHUB_LOGINS, the env list is re-applied on every sign-in.
    const admins = new Set(this.config.get("ADMIN_EMAILS", { infer: true }).split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean));
    const role = admins.has(supabaseUser.email.toLowerCase()) ? "admin" : "user";
    return this.prisma.user.upsert({
      where: { supabaseId: supabaseUser.id },
      create: { supabaseId: supabaseUser.id, email: supabaseUser.email, githubLogin: handleFromEmail(supabaseUser.email), name, role, ...consent },
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

  private anonKey(): string {
    return this.config.get("SUPABASE_ANON_KEY", { infer: true })!;
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

function errorMessage(body: Record<string, unknown>): string {
  return String(body.msg ?? body.message ?? body.error_description ?? body.error ?? "");
}

function fieldsError(issues: z.ZodIssue[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
  return new BadRequestException({ statusCode: 400, message: Object.values(fields)[0] ?? "Check the form.", fields });
}
