import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { SESSION_COOKIE, type AuthenticatedRequest } from "./session";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.auth.userFromSession(request.cookies?.[SESSION_COOKIE]);
    if (!user) throw new UnauthorizedException("Sign in required");
    request.user = user;
    return true;
  }
}
