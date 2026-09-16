import { Injectable, UnauthorizedException } from "@nestjs/common";
import { TERMS_VERSION, hasAcceptedTerms } from "../legal/terms";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { User } from "@prisma/client";
import type { SessionUser } from "@plinth-pages/shared";
import { adminLogins, type Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";

interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

interface SessionPayload {
  sub: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  callbackUrl(): string {
    return `${this.config.get("API_URL", { infer: true })}/v1/auth/github/callback`;
  }

  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.get("GITHUB_CLIENT_ID", { infer: true })!,
      redirect_uri: this.callbackUrl(),
      scope: "read:user",
      state,
      allow_signup: "true",
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  /** Exchanges the OAuth code, then upserts the user. The GitHub token is used once and discarded. */
  async signInWithCode(code: string): Promise<User> {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.config.get("GITHUB_CLIENT_ID", { infer: true }),
        client_secret: this.config.get("GITHUB_CLIENT_SECRET", { infer: true }),
        code,
        redirect_uri: this.callbackUrl(),
      }),
    });
    const token = (await tokenResponse.json()) as { access_token?: string; error_description?: string };
    if (!token.access_token) {
      throw new UnauthorizedException(token.error_description ?? "GitHub did not return an access token");
    }

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token.access_token}`,
        "User-Agent": "plinth",
      },
    });
    if (!userResponse.ok) {
      throw new UnauthorizedException(`GitHub profile request failed (${userResponse.status})`);
    }
    const github = (await userResponse.json()) as GithubUser;

    // The env list is the source of truth for super admins in Phase 0: re-applied on every sign-in.
    const admins = adminLogins({
      ADMIN_GITHUB_LOGINS: this.config.get("ADMIN_GITHUB_LOGINS", { infer: true }),
    });
    const role = admins.has(github.login.toLowerCase()) ? "admin" : "user";

    return this.prisma.user.upsert({
      where: { githubId: String(github.id) },
      create: {
        githubId: String(github.id),
        githubLogin: github.login,
        name: github.name,
        avatarUrl: github.avatar_url,
        role,
      },
      update: {
        githubLogin: github.login,
        name: github.name,
        avatarUrl: github.avatar_url,
        role,
      },
    });
  }

  signSession(user: Pick<User, "id">): Promise<string> {
    return this.jwt.signAsync({ sub: user.id } satisfies SessionPayload);
  }

  /** Returns the user for a session token, or null. Reads the DB so role changes apply immediately. */
  async userFromSession(token: string | undefined): Promise<User | null> {
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<SessionPayload>(token);
      return await this.prisma.user.findUnique({ where: { id: payload.sub } });
    } catch {
      return null;
    }
  }

  toSessionUser(user: User): SessionUser {
    return {
      id: user.id,
      githubLogin: user.githubLogin,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
      plan: user.plan,
      termsAccepted: hasAcceptedTerms(user),
    };
  }

  /** Records acceptance of the current Terms and Privacy Policy. */
  acceptTerms(userId: string, acceptedAt = new Date()): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data: { termsVersion: TERMS_VERSION, termsAcceptedAt: acceptedAt } });
  }
}
