import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { User } from "@prisma/client";
import type { MeResponse } from "@plinth-pages/shared";
import { randomBytes, timingSafeEqual } from "crypto";
import type { CookieOptions, Request, Response } from "express";
import type { Env } from "../config/env";
import { AuthService } from "./auth.service";
import { SupabaseAuth } from "./supabase-auth";
import { AllowWithoutTerms, TERMS_VERSION } from "../legal/terms";
import { CurrentUser } from "./roles";
import { OAUTH_STATE_COOKIE, SESSION_COOKIE, SESSION_TTL_SECONDS } from "./session";

/** Carries "I accept the Terms" across the GitHub round trip. */
const TERMS_COOKIE = "plinth_terms";
import { SessionGuard } from "./session.guard";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly supabase: SupabaseAuth,
  ) {}

  /** Signs the new account in, or — when Supabase requires confirmation — reports that a link was emailed. */
  @Post("register")
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const outcome = await this.supabase.register(body);
    if (outcome.kind === "confirm_email") return { confirmEmail: outcome.email };
    res.cookie(SESSION_COOKIE, await this.auth.signSession(outcome.user), this.cookieOptions(SESSION_TTL_SECONDS));
    return { user: this.auth.toSessionUser(outcome.user), next: "/onboarding" };
  }

  /** The emailed confirmation link, posted from the site's /verify-email page (a click, so mail scanners can't use it up). */
  @Post("confirm")
  @HttpCode(200)
  async confirm(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const user = await this.supabase.confirm(body);
    res.cookie(SESSION_COOKIE, await this.auth.signSession(user), this.cookieOptions(SESSION_TTL_SECONDS));
    return { user: this.auth.toSessionUser(user), next: "/start" };
  }

  @Post("resend-confirmation")
  @HttpCode(204)
  async resendConfirmation(@Body() body: unknown) {
    await this.supabase.resendConfirmation(body);
  }

  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const user = await this.supabase.login(body);
    res.cookie(SESSION_COOKIE, await this.auth.signSession(user), this.cookieOptions(SESSION_TTL_SECONDS));
    return { user: this.auth.toSessionUser(user), next: "/start" };
  }

  /** Which sign-in methods this server offers, and which Terms version sign-up accepts. */
  @Get("methods")
  methods() {
    return { email: this.supabase.configured, github: true, termsVersion: TERMS_VERSION };
  }

  /** Accepts the current Terms and Privacy Policy for the signed-in user. */
  @Post("accept-terms")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  @AllowWithoutTerms()
  async acceptTerms(@CurrentUser() user: User, @Body() body: { version?: string }) {
    if (body?.version !== TERMS_VERSION) {
      throw new BadRequestException({ statusCode: 400, code: "terms_outdated", message: "The Terms were updated while this page was open. Please review them again." });
    }
    return { user: this.auth.toSessionUser(await this.auth.acceptTerms(user.id)) };
  }

  private cookieOptions(maxAgeSeconds: number): CookieOptions {
    return {
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.get("NODE_ENV", { infer: true }) === "production",
      maxAge: maxAgeSeconds * 1000,
      path: "/",
    };
  }

  /** `?terms=<version>` when the person ticked the consent box before choosing GitHub. */
  @Get("github")
  start(@Res() res: Response, @Query("terms") terms: string | undefined) {
    const state = randomBytes(24).toString("base64url");
    res.cookie(OAUTH_STATE_COOKIE, state, this.cookieOptions(10 * 60));
    if (terms === TERMS_VERSION) res.cookie(TERMS_COOKIE, terms, this.cookieOptions(10 * 60));
    else res.clearCookie(TERMS_COOKIE, { path: "/" });
    res.redirect(this.auth.authorizeUrl(state));
  }

  @Get("github/callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const adminUrl = this.config.get("ADMIN_URL", { infer: true });
    const fail = (message: string) =>
      res.redirect(`${adminUrl}/login?auth_error=${encodeURIComponent(message)}`);

    const expected: string | undefined = req.cookies?.[OAUTH_STATE_COOKIE];
    const acceptedTerms = req.cookies?.[TERMS_COOKIE] === TERMS_VERSION;
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
    res.clearCookie(TERMS_COOKIE, { path: "/" });

    if (!code || !state || !expected || !sameString(state, expected)) {
      return fail("That sign-in link expired. Please try again.");
    }

    try {
      let user = await this.auth.signInWithCode(code);
      if (acceptedTerms) user = await this.auth.acceptTerms(user.id);
      res.cookie(SESSION_COOKIE, await this.auth.signSession(user), this.cookieOptions(SESSION_TTL_SECONDS));
      res.redirect(`${adminUrl}/start`);
    } catch (error) {
      fail(`GitHub sign-in failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  @Get("me")
  @UseGuards(SessionGuard)
  @AllowWithoutTerms()
  me(@CurrentUser() user: User): MeResponse {
    return { user: this.auth.toSessionUser(user) };
  }

  @Post("logout")
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
