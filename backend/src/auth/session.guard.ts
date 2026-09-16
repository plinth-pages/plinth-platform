import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ALLOW_WITHOUT_TERMS_KEY, hasAcceptedTerms } from "../legal/terms";
import { AuthService } from "./auth.service";
import { SESSION_COOKIE, type AuthenticatedRequest } from "./session";

/**
 * Signed-in routes. A user who hasn't accepted the current Terms is stopped here, on every route, until they do —
 * the app sends them to /accept-terms when it sees `terms_required`.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.auth.userFromSession(request.cookies?.[SESSION_COOKIE]);
    if (!user) throw new UnauthorizedException("Sign in required");
    request.user = user;

    const exempt = this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_WITHOUT_TERMS_KEY, [context.getHandler(), context.getClass()]);
    if (!exempt && !hasAcceptedTerms(user)) {
      throw new ForbiddenException({ statusCode: 403, code: "terms_required", message: "Please review and accept the Terms and Privacy Policy to continue." });
    }
    return true;
  }
}
