import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { propsSchemaFor, validateManifest, type IntegrationManifest, type PropValue } from "@plinth-pages/integration-types";
import type { Integration } from "@prisma/client";
import type { CatalogueIntegration, LiveCheck, ValidatePropsResponse } from "@plinth-pages/shared";
import { PrismaService } from "../prisma/prisma.service";

/** Lets tests replace outbound HTTP. */
export const CATALOGUE_FETCH = Symbol("CATALOGUE_FETCH");

/** How long a live lookup (does this username exist?) is remembered, to stay well inside public rate limits. */
const LIVE_CACHE_MS = 10 * 60_000;

export interface CatalogueEntry {
  row: Integration;
  manifest: IntegrationManifest;
}

@Injectable()
export class CatalogueService {
  private readonly liveCache = new Map<string, { value: LiveCheck; until: number }>();
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(CATALOGUE_FETCH) fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async list(): Promise<CatalogueIntegration[]> {
    const rows = await this.prisma.integration.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    return rows.flatMap((row) => {
      const parsed = validateManifest(row.manifest);
      return parsed.ok ? [toCatalogue(row, parsed.manifest)] : [];
    });
  }

  /** An active integration and its validated manifest, or 404. */
  async entry(id: string): Promise<CatalogueEntry> {
    const row = await this.prisma.integration.findUnique({ where: { id } });
    const parsed = row?.isActive ? validateManifest(row.manifest) : null;
    if (!row || !parsed?.ok) throw new NotFoundException(`There's no integration called "${id}".`);
    return { row, manifest: parsed.manifest };
  }

  /** Validates props against the manifest. Throws 400 with a message per field. */
  parseProps(manifest: IntegrationManifest, props: unknown): Record<string, PropValue> {
    const parsed = propsSchemaFor(manifest).safeParse(props ?? {});
    if (parsed.success) return parsed.data;
    throw new BadRequestException({ statusCode: 400, message: "Some settings aren't valid.", fields: fieldErrors(parsed.error.issues) });
  }

  async validate(id: string, props: unknown): Promise<ValidatePropsResponse> {
    const { manifest } = await this.entry(id);
    const parsed = propsSchemaFor(manifest).safeParse(props ?? {});
    if (!parsed.success) return { ok: false, fields: fieldErrors(parsed.error.issues), live: {} };
    const live = await this.liveChecks(id, parsed.data);
    const fields = Object.fromEntries(Object.entries(live).filter(([, check]) => check.status === "not_found").map(([name, check]) => [name, check.message]));
    return { ok: Object.keys(fields).length === 0, fields, live };
  }

  /** Confirms public identifiers exist, where the source has a public lookup. `unknown` never blocks an install. */
  private async liveChecks(id: string, props: Record<string, PropValue>): Promise<Record<string, LiveCheck>> {
    const username = typeof props.username === "string" ? props.username : null;
    if (!username) return {};
    if (id === "github-stats") {
      return { username: await this.cached(`github:${username.toLowerCase()}`, () => this.githubUser(username)) };
    }
    if (id === "leetcode-stats") {
      return { username: await this.cached(`leetcode:${username.toLowerCase()}`, () => this.leetcodeUser(username)) };
    }
    return {};
  }

  private async githubUser(username: string): Promise<LiveCheck> {
    try {
      const response = await this.fetchImpl(`https://api.github.com/users/${encodeURIComponent(username)}`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "plinth-catalogue" },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 404) return { status: "not_found", message: `There's no GitHub account called ${username}.` };
      if (!response.ok) return { status: "unknown", message: "GitHub couldn't be checked right now." };
      const user = (await response.json()) as { login: string; name: string | null };
      return { status: "found", message: user.name ? `${user.name} (@${user.login})` : `@${user.login}` };
    } catch {
      return { status: "unknown", message: "GitHub couldn't be checked right now." };
    }
  }

  private async leetcodeUser(username: string): Promise<LiveCheck> {
    try {
      const response = await this.fetchImpl("https://leetcode.com/graphql/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Referer: "https://leetcode.com" },
        body: JSON.stringify({ query: "query($u:String!){matchedUser(username:$u){username}}", variables: { u: username } }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return { status: "unknown", message: "LeetCode couldn't be checked right now." };
      const json = (await response.json()) as { data?: { matchedUser: { username: string } | null } };
      if (!json.data) return { status: "unknown", message: "LeetCode couldn't be checked right now." };
      return json.data.matchedUser
        ? { status: "found", message: json.data.matchedUser.username }
        : { status: "not_found", message: `There's no LeetCode account called ${username}.` };
    } catch {
      return { status: "unknown", message: "LeetCode couldn't be checked right now." };
    }
  }

  private async cached(key: string, load: () => Promise<LiveCheck>): Promise<LiveCheck> {
    const hit = this.liveCache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = await load();
    if (value.status !== "unknown") this.liveCache.set(key, { value, until: Date.now() + LIVE_CACHE_MS });
    if (this.liveCache.size > 2_000) this.liveCache.clear();
    return value;
  }
}

export function toCatalogue(row: Integration, manifest: IntegrationManifest): CatalogueIntegration {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    category: manifest.category,
    package: manifest.package,
    version: manifest.version,
    kind: manifest.component.kind,
    defaultSlot: manifest.defaultSlot,
    allowedSlots: manifest.allowedSlots,
    props: manifest.props,
    recommendedFor: manifest.recommendedFor,
    homepage: manifest.homepage ?? null,
    source: row.tarball ? "vendored" : "npm",
    secrets: manifest.secrets,
    addsServerRoute: manifest.files.length > 0,
  };
}

function fieldErrors(issues: { path: (string | number)[]; message: string }[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "_");
    fields[key] ??= issue.message.startsWith("Unrecognized key") ? `Unknown setting: ${issue.message.replace(/^.*: /, "")}` : issue.message;
  }
  return fields;
}
