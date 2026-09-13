import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { validateManifest, type IntegrationManifest } from "@plinth-pages/integration-types";
import type { Prisma } from "@prisma/client";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, relative, resolve } from "path";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { readTarballFiles } from "./tarball";

export interface IngestResult {
  ingested: string[];
  rejected: { source: string; reasons: string[] }[];
}

/** Where vendored integration tarballs live: `integrations/<id>/<package>-<version>.tgz` in the platform repository. */
export function integrationsDir(config: ConfigService<Env, true>): string {
  return resolve(config.get("INTEGRATIONS_DIR", { infer: true }) ?? join(process.cwd(), "..", "integrations"));
}

/**
 * Reads a package tarball's own package.json and plinth.manifest.json and decides whether it can enter the catalogue.
 * The manifest must validate — including every slot belonging to the vocabulary — and must describe this package
 * and version, so a manifest can't claim to install something it isn't.
 */
export function inspectTarball(tgz: Buffer): { manifest: IntegrationManifest } | { reasons: string[] } {
  let files: Record<string, string>;
  try {
    files = readTarballFiles(tgz, ["package/package.json", "package/plinth.manifest.json"]);
  } catch (error) {
    return { reasons: [`Not a readable package tarball: ${error instanceof Error ? error.message : error}`] };
  }
  if (!files["package/plinth.manifest.json"]) return { reasons: ["The package has no plinth.manifest.json."] };
  if (!files["package/package.json"]) return { reasons: ["The package has no package.json."] };

  let pkg: { name?: string; version?: string };
  let raw: unknown;
  try {
    pkg = JSON.parse(files["package/package.json"]);
    raw = JSON.parse(files["package/plinth.manifest.json"]);
  } catch {
    return { reasons: ["package.json or plinth.manifest.json isn't valid JSON."] };
  }

  const result = validateManifest(raw);
  if (!result.ok) return { reasons: result.issues.map((issue) => `${issue.path}: ${issue.message}`) };
  const reasons: string[] = [];
  if (result.manifest.package !== pkg.name) reasons.push(`The manifest names ${result.manifest.package}, but the package is ${pkg.name}.`);
  if (result.manifest.version !== pkg.version) reasons.push(`The manifest is for ${result.manifest.version}, but the package is ${pkg.version}.`);
  return reasons.length ? { reasons } : { manifest: result.manifest };
}

/** Worker only: loads the catalogue from vendored integration packages when the worker starts. */
@Injectable()
export class CatalogueIngest implements OnApplicationBootstrap {
  private readonly logger = new Logger(CatalogueIngest.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap() {
    const result = await this.ingest(integrationsDir(this.config));
    this.logger.log(`Catalogue: ${result.ingested.length} integration(s) ingested${result.rejected.length ? `, ${result.rejected.length} rejected` : ""}`);
    for (const rejected of result.rejected) this.logger.warn(`Rejected ${rejected.source}: ${rejected.reasons.join("; ")}`);
  }

  async ingest(dir: string): Promise<IngestResult> {
    const result: IngestResult = { ingested: [], rejected: [] };
    if (!existsSync(dir)) return result;

    for (const entry of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      for (const file of readdirSync(join(dir, entry.name)).filter((name) => name.endsWith(".tgz"))) {
        const path = join(dir, entry.name, file);
        const inspected = inspectTarball(readFileSync(path));
        if ("reasons" in inspected) {
          result.rejected.push({ source: relative(dir, path), reasons: inspected.reasons });
          continue;
        }
        const { manifest } = inspected;
        if (manifest.id !== entry.name) {
          result.rejected.push({ source: relative(dir, path), reasons: [`The manifest id "${manifest.id}" doesn't match its directory "${entry.name}".`] });
          continue;
        }
        const data = {
          name: manifest.name,
          category: manifest.category,
          packageName: manifest.package,
          latestVersion: manifest.version,
          manifest: manifest as unknown as Prisma.InputJsonValue,
          tarball: relative(dir, path).split("\\").join("/"),
        };
        // First-party packages are active on first ingestion; a later deactivation by an admin is kept.
        await this.prisma.integration.upsert({ where: { id: manifest.id }, create: { id: manifest.id, ...data, isActive: true }, update: data });
        result.ingested.push(manifest.id);
      }
    }
    return result;
  }
}
