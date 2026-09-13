import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { AdminIntegrationRequestsResponse, IntegrationRequestResponse, IntegrationRequestStat } from "@plinth-pages/shared";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { CatalogueService } from "./catalogue.service";
import { PLANNED_INTEGRATIONS } from "./planned-integrations";

/** Keeps one account from flooding the ranking with suggestions. */
export const MAX_REQUESTS_PER_USER = 50;
const SUGGESTED_PREFIX = "suggested:";

const requestBody = z
  .object({
    key: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(2, "Name the integration you'd like.").max(60, "Keep the name under 60 characters.").optional(),
    note: z.string().trim().max(280, "Keep the note under 280 characters.").optional(),
    portfolioId: z.string().max(64).optional(),
  })
  .refine((body) => body.key || body.name, "Choose an integration or name one.");

/** Turns "Notion Pages!" into "notion-pages", so the same wish typed twice counts once. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

@Injectable()
export class IntegrationRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogue: CatalogueService,
  ) {}

  /** Keys the user has asked for. */
  async keysFor(user: User): Promise<string[]> {
    const rows = await this.prisma.integrationRequest.findMany({ where: { userId: user.id }, select: { key: true } });
    return rows.map((row) => row.key);
  }

  async request(user: User, body: unknown): Promise<IntegrationRequestResponse> {
    const parsed = requestBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid request");
    const { key, name, note, portfolioId } = parsed.data;
    const target = await this.resolve(key, name);

    const existing = await this.prisma.integrationRequest.findUnique({ where: { userId_key: { userId: user.id, key: target.key } } });
    if (!existing && (await this.prisma.integrationRequest.count({ where: { userId: user.id } })) >= MAX_REQUESTS_PER_USER) {
      throw new HttpException(`You can request up to ${MAX_REQUESTS_PER_USER} integrations.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const ownedPortfolio = portfolioId
      ? await this.prisma.portfolio.findFirst({ where: { id: portfolioId, userId: user.id }, select: { id: true } })
      : null;

    await this.prisma.integrationRequest.upsert({
      where: { userId_key: { userId: user.id, key: target.key } },
      create: { userId: user.id, key: target.key, name: target.name, note: note || null, portfolioId: ownedPortfolio?.id ?? null },
      // Asking again only updates the note: it is still one vote.
      update: note ? { note } : {},
    });
    return { key: target.key, name: target.name, requested: true };
  }

  async withdraw(user: User, key: string): Promise<IntegrationRequestResponse> {
    const row = await this.prisma.integrationRequest.findUnique({ where: { userId_key: { userId: user.id, key } } });
    if (!row) throw new NotFoundException("You haven't requested that integration.");
    await this.prisma.integrationRequest.delete({ where: { id: row.id } });
    return { key, name: row.name, requested: false };
  }

  /** Superadmin: every request, grouped and ranked by how many people asked. */
  async stats(): Promise<AdminIntegrationRequestsResponse> {
    const rows = await this.prisma.integrationRequest.findMany({
      select: { key: true, name: true, note: true, userId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20_000,
    });
    const planned = new Map(PLANNED_INTEGRATIONS.map((entry) => [entry.id, entry]));
    const groups = new Map<string, IntegrationRequestStat>();
    for (const row of rows) {
      const definition = planned.get(row.key);
      const group = groups.get(row.key) ?? {
        key: row.key,
        name: definition?.name ?? row.name,
        category: definition?.category ?? null,
        planned: Boolean(definition),
        count: 0,
        firstRequestedAt: row.createdAt.toISOString(),
        lastRequestedAt: row.createdAt.toISOString(),
        notes: [],
      };
      group.count += 1;
      group.firstRequestedAt = row.createdAt.toISOString(); // rows are newest first
      if (row.note && group.notes.length < 5) group.notes.push(row.note);
      groups.set(row.key, group);
    }
    return {
      totalRequests: rows.length,
      uniqueRequesters: new Set(rows.map((row) => row.userId)).size,
      items: [...groups.values()].sort((a, b) => b.count - a.count || b.lastRequestedAt.localeCompare(a.lastRequestedAt)),
    };
  }

  private async resolve(key: string | undefined, name: string | undefined): Promise<{ key: string; name: string }> {
    const available = await this.catalogue.list();
    if (key) {
      if (available.some((entry) => entry.id === key)) throw new ConflictException("That integration is already available. Install it instead.");
      const definition = PLANNED_INTEGRATIONS.find((entry) => entry.id === key);
      if (definition) return { key: definition.id, name: definition.name };
      if (key.startsWith(SUGGESTED_PREFIX) && name) return this.resolve(undefined, name);
      throw new NotFoundException(`There's no planned integration called "${key}".`);
    }

    const slug = slugify(name!);
    if (!slug) throw new BadRequestException("Name the integration you'd like.");
    const matches = (candidate: { id: string; name: string }) => candidate.id === slug || slugify(candidate.name) === slug;
    const live = available.find(matches);
    if (live) throw new ConflictException(`${live.name} is already available. Install it instead.`);
    const definition = PLANNED_INTEGRATIONS.find(matches);
    if (definition) return { key: definition.id, name: definition.name };
    return { key: `${SUGGESTED_PREFIX}${slug}`, name: name! };
  }
}
