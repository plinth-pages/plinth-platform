import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { InstalledIntegrationsResponse, OperationStatus, OperationSummary, PendingIntegrationChange } from "@plinth-pages/shared";
import { z } from "zod";
import { CatalogueService } from "../catalogue/catalogue.service";
import { PrismaService } from "../prisma/prisma.service";
import { MAX_INSTALLED_INTEGRATIONS } from "./integration-planner";
import { OperationsService } from "./operations.service";

const IN_FLIGHT: OperationStatus[] = ["queued", "staging", "checking", "applying"];

const installBody = z.object({ integrationId: z.string().min(1).max(64), slot: z.string().min(1).max(64).optional(), props: z.unknown().optional() });
const moveBody = z.object({ slot: z.string().min(1).max(64) });

/**
 * Api side of installing, moving and removing integrations. Everything a user can get wrong is answered here, straight
 * away; the worker re-checks against the repository itself inside the operation, where nothing can race it.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogue: CatalogueService,
    private readonly operations: OperationsService,
  ) {}

  async list(user: User, portfolioId: string): Promise<InstalledIntegrationsResponse> {
    await this.ready(user, portfolioId, false);
    const [rows, catalogue, inFlight] = await Promise.all([
      this.prisma.installedIntegration.findMany({ where: { portfolioId }, orderBy: { createdAt: "asc" } }),
      this.catalogue.list(),
      this.prisma.operation.findMany({
        where: { portfolioId, type: { in: ["install", "uninstall", "move"] }, status: { in: IN_FLIGHT } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
    return {
      installed: rows.map((row) => ({
        id: row.integrationId,
        name: byId.get(row.integrationId)?.name ?? row.integrationId,
        package: byId.get(row.integrationId)?.package ?? "",
        version: row.version,
        slot: row.slot,
        props: row.props as Record<string, string | number | boolean>,
        allowedSlots: byId.get(row.integrationId)?.allowedSlots ?? [row.slot],
        installedAt: row.createdAt.toISOString(),
      })),
      pending: inFlight.map((operation): PendingIntegrationChange => {
        const input = operation.input as { integrationId: string; slot?: string };
        return { integrationId: input.integrationId, type: operation.type as PendingIntegrationChange["type"], slot: input.slot ?? null, operationId: operation.id, status: operation.status };
      }),
      limit: MAX_INSTALLED_INTEGRATIONS,
    };
  }

  async install(user: User, portfolioId: string, body: unknown): Promise<OperationSummary> {
    await this.ready(user, portfolioId);
    const parsed = installBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Choose an integration to install.");
    const { manifest } = await this.catalogue.entry(parsed.data.integrationId);

    const slot = parsed.data.slot ?? manifest.defaultSlot;
    if (!(manifest.allowedSlots as string[]).includes(slot)) {
      throw new BadRequestException(`${manifest.name} can't be placed in "${slot}". Choose one of: ${manifest.allowedSlots.join(", ")}.`);
    }
    const props = this.catalogue.parseProps(manifest, parsed.data.props);
    const checked = await this.catalogue.validate(manifest.id, props);
    if (!checked.ok) throw new BadRequestException({ statusCode: 400, message: "Some settings aren't valid.", fields: checked.fields });

    const [installed, count, pending] = await Promise.all([
      this.prisma.installedIntegration.findUnique({ where: { portfolioId_integrationId: { portfolioId, integrationId: manifest.id } } }),
      this.prisma.installedIntegration.count({ where: { portfolioId } }),
      this.prisma.operation.count({ where: { portfolioId, type: "install", status: { in: IN_FLIGHT } } }),
    ]);
    if (installed) throw new ConflictException(`${manifest.name} is already installed. Move or remove it instead.`);
    if (count + pending >= MAX_INSTALLED_INTEGRATIONS) {
      throw new ConflictException(`Your plan includes up to ${MAX_INSTALLED_INTEGRATIONS} integrations. Remove one to add another.`);
    }
    return this.operations.enqueue(portfolioId, "install", `Install ${manifest.name}`, { integrationId: manifest.id, slot, props });
  }

  async move(user: User, portfolioId: string, integrationId: string, body: unknown): Promise<OperationSummary> {
    await this.ready(user, portfolioId);
    const parsed = moveBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Choose where to move it.");
    const { manifest } = await this.catalogue.entry(integrationId);
    await this.installed(portfolioId, integrationId);
    if (!(manifest.allowedSlots as string[]).includes(parsed.data.slot)) {
      throw new BadRequestException(`${manifest.name} can't be placed in "${parsed.data.slot}".`);
    }
    return this.operations.enqueue(portfolioId, "move", `Move ${manifest.name} to ${parsed.data.slot}`, { integrationId, slot: parsed.data.slot });
  }

  async uninstall(user: User, portfolioId: string, integrationId: string): Promise<OperationSummary> {
    await this.ready(user, portfolioId);
    await this.installed(portfolioId, integrationId);
    const row = await this.prisma.integration.findUnique({ where: { id: integrationId }, select: { name: true } });
    return this.operations.enqueue(portfolioId, "uninstall", `Remove ${row?.name ?? integrationId}`, { integrationId });
  }

  private async installed(portfolioId: string, integrationId: string) {
    const row = await this.prisma.installedIntegration.findUnique({ where: { portfolioId_integrationId: { portfolioId, integrationId } } });
    if (!row) throw new NotFoundException("That integration isn't installed.");
    return row;
  }

  private async ready(user: User, portfolioId: string, requireReady = true) {
    const portfolio = await this.prisma.portfolio.findFirst({ where: { id: portfolioId, userId: user.id }, select: { status: true } });
    if (!portfolio) throw new NotFoundException("Portfolio not found");
    if (requireReady && portfolio.status !== "ready") throw new ConflictException("The portfolio's repository isn't ready yet.");
  }
}
