import { CanActivate, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";

/** Makes a route not exist in production, rather than merely forbidden. */
@Injectable()
export class DevOnlyGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(): boolean {
    if (this.config.get("NODE_ENV", { infer: true }) === "production") {
      throw new NotFoundException();
    }
    return true;
  }
}
