import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { validateManifest } from "@plinth-pages/integration-types";
import { PrismaService } from "../prisma/prisma.service";
import { VERCEL_CLIENT } from "../hosting/hosting";
import type { VercelClient } from "../hosting/vercel.client";
import { SANDBOX_DRIVER, SandboxNotRunningError, type SandboxDriver } from "../sandbox/sandbox-driver";
import { renderEnvFile } from "../sandbox/e2b.driver";
import { secretContext, type Vault } from "./vault";
import { VAULT } from "./vault.provider";

/** Where secrets are delivered at runtime. Implemented by CredentialSync; optional so the lifecycle runs without it. */
export const SECRET_ENVIRONMENT = Symbol("SECRET_ENVIRONMENT");
export interface SecretEnvironment {
  forPortfolio(portfolioId: string): Promise<Record<string, string>>;
}

/**
 * Worker: delivers a portfolio's secrets to the two places code runs — the preview sandbox (`.env.local`, which git
 * ignores; the dev server is restarted when it changes) and production (sensitive Vercel environment variables, applied on the next
 * deployment). Plaintext is decrypted here, in memory, and sent nowhere else.
 */
@Injectable()
export class CredentialSync implements SecretEnvironment {
  private readonly logger = new Logger(CredentialSync.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(VAULT) private readonly vault: Vault | null,
    @Inject(SANDBOX_DRIVER) private readonly driver: SandboxDriver,
    @Optional() @Inject(VERCEL_CLIENT) private readonly vercel: VercelClient | null = null,
  ) {}

  async forPortfolio(portfolioId: string): Promise<Record<string, string>> {
    if (!this.vault) return {};
    const rows = await this.prisma.credential.findMany({ where: { portfolioId }, orderBy: { key: "asc" } });
    const env: Record<string, string> = {};
    for (const row of rows) {
      try {
        env[row.key] = this.vault.open(row, secretContext(portfolioId, row.key));
      } catch (error) {
        // Never log the value; the name and reason are enough to act on.
        this.logger.error(`Credential ${row.key} for ${portfolioId} couldn't be opened: ${(error as Error).message}`);
      }
    }
    return env;
  }

  /** Rewrites the preview's `.env.local` and production's variables to exactly the current set. */
  async sync(portfolioId: string): Promise<{ sandbox: "written" | "not_running"; production: "synced" | "not_published" | "not_configured" }> {
    const env = await this.forPortfolio(portfolioId);
    return { sandbox: await this.syncSandbox(portfolioId, env), production: await this.syncProduction(portfolioId, env) };
  }

  async syncSandbox(portfolioId: string, env?: Record<string, string>): Promise<"written" | "not_running"> {
    const sandbox = await this.prisma.sandbox.findUnique({ where: { portfolioId } });
    if (!sandbox?.externalId || sandbox.status !== "running") return "not_running";
    const contents = renderEnvFile(env ?? (await this.forPortfolio(portfolioId)));
    try {
      const result = await this.driver.exec(sandbox.externalId, WRITE_ENV_SCRIPT, {
        root: "live",
        cwd: ".",
        envs: { PLINTH_ENV_B64: Buffer.from(contents).toString("base64") },
        timeoutMs: 30_000,
      });
      if (result.exitCode !== 0) throw new Error(`exit ${result.exitCode}`);
      // Route handlers read process.env, which next dev only loads at start.
      if (result.stdout.includes("PLINTH_ENV_CHANGED=1")) await this.driver.restartDevServer(sandbox.externalId, { clearCache: false });
      return "written";
    } catch (error) {
      if (error instanceof SandboxNotRunningError) return "not_running";
      throw error;
    }
  }

  /**
   * Upserts every secret as a sensitive production variable and deletes the ones Plinth manages but the portfolio no
   * longer has. Variables the user added in Vercel themselves are left alone.
   */
  async syncProduction(portfolioId: string, env?: Record<string, string>, projectId?: string): Promise<"synced" | "not_published" | "not_configured"> {
    if (!this.vercel) return "not_configured";
    const project = projectId ?? (await this.prisma.portfolio.findUnique({ where: { id: portfolioId }, select: { vercelProjectId: true } }))?.vercelProjectId;
    if (!project) return "not_published";
    const values = env ?? (await this.forPortfolio(portfolioId));

    const managed = await this.managedNames();
    const existing = await this.vercel.listEnv(project);
    for (const variable of existing) {
      if (managed.has(variable.key) && !(variable.key in values)) await this.vercel.deleteEnv(project, variable.id);
    }
    for (const [key, value] of Object.entries(values)) await this.vercel.upsertSensitiveEnv(project, key, value);

    await this.prisma.credential.updateMany({ where: { portfolioId }, data: { syncedAt: new Date() } });
    this.logger.log(`Synced ${Object.keys(values).length} secret(s) to production for ${portfolioId}`);
    return "synced";
  }

  /** Every secret name any catalogue integration declares — the only variables Plinth ever deletes. */
  private async managedNames(): Promise<Set<string>> {
    const rows = await this.prisma.integration.findMany({ select: { manifest: true } });
    const names = new Set<string>();
    for (const row of rows) {
      const parsed = validateManifest(row.manifest);
      if (parsed.ok) for (const spec of parsed.manifest.secrets) names.add(spec.env);
    }
    return names;
  }
}

/** Writes `.env.local` in the live tree with owner-only permissions. The contents arrive base64-encoded in the environment. */
const WRITE_ENV_SCRIPT = `# plinth:step=env
set -eo pipefail
umask 077
printf '%s' "$PLINTH_ENV_B64" | base64 -d > .env.local.tmp
if [ -f .env.local ] && cmp -s .env.local.tmp .env.local; then
  rm -f .env.local.tmp
else
  mv -f .env.local.tmp .env.local
  echo "PLINTH_ENV_CHANGED=1"
fi
chmod 600 .env.local
`;
