import { InjectQueue } from "@nestjs/bullmq";
import { BadRequestException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { IntegrationCredentials, PortfolioCredentialsResponse } from "@plinth-pages/shared";
import type { Queue } from "bullmq";
import { z } from "zod";
import { CatalogueService } from "../catalogue/catalogue.service";
import { credentialSyncJobId, OPERATIONS_QUEUE, SYNC_CREDENTIALS_JOB_OPTIONS, type OperationJobData } from "../operations/operations.constants";
import { PrismaService } from "../prisma/prisma.service";
import { verifySecret } from "./secret-verifier";
import { secretContext, secretHint, type Vault } from "./vault";
import { VAULT } from "./vault.provider";

/** Lets tests replace the provider checks' outbound HTTP. */
export const VERIFY_FETCH = Symbol("VERIFY_FETCH");

const connectBody = z.object({ values: z.record(z.string().max(500)) });

/**
 * Api side of the vault. Values arrive once, are verified with their provider, sealed, and never returned: every
 * response carries only names, labels and a masked hint. Syncing to the preview and production runs on the worker.
 */
@Injectable()
export class CredentialsService {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogue: CatalogueService,
    @Inject(VAULT) private readonly vault: Vault | null,
    @InjectQueue(OPERATIONS_QUEUE) private readonly queue: Queue<OperationJobData>,
    @Optional() @Inject(VERIFY_FETCH) fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async list(user: User, portfolioId: string): Promise<PortfolioCredentialsResponse> {
    await this.owned(user, portfolioId);
    const [rows, catalogue] = await Promise.all([this.prisma.credential.findMany({ where: { portfolioId } }), this.catalogue.list()]);
    const byEnv = new Map(rows.map((row) => [row.key, row]));
    const integrations: IntegrationCredentials[] = catalogue
      .filter((entry) => entry.secrets.length > 0)
      .map((entry) => ({
        integrationId: entry.id,
        secrets: entry.secrets.map((spec) => {
          const row = byEnv.get(spec.env);
          return {
            env: spec.env,
            label: spec.label,
            kind: spec.kind,
            required: spec.required,
            connected: Boolean(row),
            hint: row?.hint ?? null,
            verifiedAt: row?.verifiedAt.toISOString() ?? null,
            // verifiedAt changes only with the value; updatedAt also moves when syncedAt is recorded.
            syncedToProduction: Boolean(row?.syncedAt && row.syncedAt >= row.verifiedAt),
          };
        }),
      }));
    return { vaultConfigured: this.vault !== null, integrations };
  }

  async connect(user: User, portfolioId: string, integrationId: string, body: unknown): Promise<PortfolioCredentialsResponse> {
    await this.owned(user, portfolioId);
    if (!this.vault) throw new ServiceUnavailableException("Secure key storage isn't set up on this server yet.");
    const { manifest } = await this.catalogue.entry(integrationId);
    if (manifest.secrets.length === 0) throw new BadRequestException(`${manifest.name} doesn't need any keys.`);

    const parsed = connectBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Send the keys as { values: { NAME: value } }.");
    const known = new Set(manifest.secrets.map((spec) => spec.env));
    const unknown = Object.keys(parsed.data.values).filter((env) => !known.has(env));
    if (unknown.length) throw new BadRequestException(`${manifest.name} doesn't use ${unknown.join(", ")}.`);

    const existing = new Set((await this.prisma.credential.findMany({ where: { portfolioId, key: { in: [...known] } }, select: { key: true } })).map((row) => row.key));
    const fields: Record<string, string> = {};
    const accepted: { spec: (typeof manifest.secrets)[number]; value: string }[] = [];
    for (const spec of manifest.secrets) {
      const value = parsed.data.values[spec.env]?.trim();
      if (!value) {
        // Blank keeps what's stored, so one key can be replaced without re-entering the others.
        if (spec.required && !existing.has(spec.env)) fields[spec.env] = `${spec.label} is required.`;
        continue;
      }
      const verdict = await verifySecret(spec, value, this.fetchImpl);
      if (verdict.ok) accepted.push({ spec, value });
      else fields[spec.env] = verdict.message;
    }
    if (Object.keys(fields).length) throw new BadRequestException({ statusCode: 400, message: "Some keys weren't accepted.", fields });

    const now = new Date();
    await this.prisma.$transaction(
      accepted.map(({ spec, value }) => {
        const sealed = this.vault!.seal(value, secretContext(portfolioId, spec.env));
        const data = { integrationId: manifest.id, ...sealed, hint: secretHint(value, spec.kind), verifiedAt: now, syncedAt: null };
        return this.prisma.credential.upsert({
          where: { portfolioId_key: { portfolioId, key: spec.env } },
          create: { portfolioId, key: spec.env, ...data },
          update: data,
        });
      }),
    );
    await this.scheduleSync(portfolioId);
    return this.list(user, portfolioId);
  }

  async disconnect(user: User, portfolioId: string, integrationId: string): Promise<PortfolioCredentialsResponse> {
    await this.owned(user, portfolioId);
    const { count } = await this.prisma.credential.deleteMany({ where: { portfolioId, integrationId } });
    if (count === 0) throw new NotFoundException("There are no keys to disconnect.");
    await this.scheduleSync(portfolioId);
    return this.list(user, portfolioId);
  }

  /** Env names the integration still needs before it can be installed. */
  async missingFor(portfolioId: string, integrationId: string): Promise<string[]> {
    const { manifest } = await this.catalogue.entry(integrationId);
    const required = manifest.secrets.filter((spec) => spec.required);
    if (required.length === 0) return [];
    const stored = new Set((await this.prisma.credential.findMany({ where: { portfolioId, key: { in: required.map((spec) => spec.env) } }, select: { key: true } })).map((row) => row.key));
    return required.filter((spec) => !stored.has(spec.env)).map((spec) => spec.label);
  }

  private scheduleSync(portfolioId: string) {
    // One pending sync per portfolio is enough: it always writes the current set.
    return this.queue.add("sync-credentials", { portfolioId }, { jobId: credentialSyncJobId(portfolioId), ...SYNC_CREDENTIALS_JOB_OPTIONS });
  }

  private async owned(user: User, portfolioId: string) {
    const portfolio = await this.prisma.portfolio.findFirst({ where: { id: portfolioId, userId: user.id }, select: { id: true } });
    if (!portfolio) throw new NotFoundException("Portfolio not found");
  }
}
