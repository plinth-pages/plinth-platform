import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Sandbox } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { gitAuthEnv } from "../sandbox/e2b.driver";
import { SANDBOX_DRIVER, type SandboxDriver } from "../sandbox/sandbox-driver";
import { GIT_TOKENS, type GitTokenSource } from "../sandbox/git-tokens";
import { reported } from "./check-output";
import { pushScript } from "./git-scripts";
import type { PendingPushes } from "./pending-pushes";

export class PushFailedError extends Error {
  constructor(detail: string) {
    super(`Pushing to draft failed: ${detail}`);
    this.name = "PushFailedError";
  }
}

@Injectable()
export class GitSync implements PendingPushes {
  private readonly logger = new Logger(GitSync.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SANDBOX_DRIVER) private readonly driver: SandboxDriver,
    @Inject(GIT_TOKENS) private readonly tokens: GitTokenSource,
  ) {}

  /** Pushes the live tree's HEAD to draft and clears the pending flag. On failure, sets it and throws. */
  async push(sandbox: Pick<Sandbox, "id" | "externalId">): Promise<string> {
    const token = await this.tokens.installationToken();
    const result = await this.driver.exec(sandbox.externalId!, pushScript(), {
      root: "live",
      cwd: ".",
      envs: gitAuthEnv(token),
      timeoutMs: 90_000,
    });
    const pushed = reported(result.stdout, "PUSHED");
    if (result.exitCode !== 0 || !pushed) {
      await this.prisma.sandbox.update({ where: { id: sandbox.id }, data: { pendingPush: true } });
      throw new PushFailedError(redactToken((result.stderr || result.stdout).trim().slice(-500), token));
    }
    await this.prisma.sandbox.update({ where: { id: sandbox.id }, data: { pendingPush: false } });
    return pushed;
  }

  async flush(sandbox: Sandbox): Promise<void> {
    if (!sandbox.pendingPush || !sandbox.externalId) return;
    this.logger.log(`Flushing an unpushed commit for portfolio ${sandbox.portfolioId} before stopping its sandbox`);
    await this.push(sandbox);
  }
}

function redactToken(text: string, token: string): string {
  return text.split(token).join("[redacted]");
}
