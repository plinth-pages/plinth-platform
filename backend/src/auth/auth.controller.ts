import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { User } from "@prisma/client";
import type { MeResponse } from "@plinth-pages/shared";
import { randomBytes, timingSafeEqual } from "crypto";
import type { CookieOptions, Request, Response } from "express";
import type { Env } from "../config/env";
import { AuthService } from "./auth.service";
import { SupabaseAuth } from "./supabase-auth";
import { CurrentUser } from "./roles";
import { OAUTH_STATE_COOKIE, SESSION_COOKIE, SESSION_TTL_SECONDS } from "./session";
import { SessionGuard } from "./session.guard";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly supabase: SupabaseAuth,
  ) {}

  /** Creates a confirmed account and signs it in immediately: no confirmation email. */
  @Post("register")
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const user = await this.supabase.register(body);
    res.cookie(SESSION_COOKIE, await this.auth.signSession(user), this.cookieOptions(SESSION_TTL_SECONDS));
    return { user: this.auth.toSessionUser(user), next: "/onboarding" };
  }

  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const user = await this.supabase.login(body);
    res.cookie(SESSION_COOKIE, await this.auth.signSession(user), this.cookieOptions(SESSION_TTL_SECONDS));
    return { user: this.auth.toSessionUser(user), next: "/start" };
  }

  /** Which sign-in methods this server offers. */
  @Get("methods")
  methods() {
    return { email: this.supabase.configured, github: true };
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

  @Get("github")
  start(@Res() res: Response) {
    const state = randomBytes(24).toString("base64url");
    res.cookie(OAUTH_STATE_COOKIE, state, this.cookieOptions(10 * 60));
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
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });

    if (!code || !state || !expected || !sameString(state, expected)) {
      return fail("That sign-in link expired. Please try again.");
    }

    try {
      const user = await this.auth.signInWithCode(code);
      res.cookie(SESSION_COOKIE, await this.auth.signSession(user), this.cookieOptions(SESSION_TTL_SECONDS));
      res.redirect(`${adminUrl}/start`);
    } catch (error) {
      fail(`GitHub sign-in failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  @Get("me")
  @UseGuards(SessionGuard)
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
