import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CodemodError,
  installIntegration,
  moveIntegration,
  uninstallIntegration,
  type PortfolioFile,
  type PortfolioFiles,
  type ProjectResult,
} from "@plinth-pages/codemod";
import { validateManifest, type IntegrationManifest } from "@plinth-pages/integration-types";
import type { Operation, Prisma } from "@prisma/client";
import type { OperationFailure } from "@plinth-pages/shared";
import { readFileSync } from "fs";
import { basename, join } from "path";
import { z } from "zod";
import { integrationsDir } from "../catalogue/catalogue-ingest";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { SANDBOX_DRIVER, type SandboxDriver } from "../sandbox/sandbox-driver";

/** Free plan: at most this many integrations per portfolio. Enforced inside the operation, where it can't be raced. */
export const MAX_INSTALLED_INTEGRATIONS = 5;

const propValue = z.union([z.string(), z.number().finite(), z.boolean()]);
export const installInputSchema = z.object({ integrationId: z.string().min(1), slot: z.string().min(1), props: z.record(propValue) });
export const uninstallInputSchema = z.object({ integrationId: z.string().min(1) });
export const moveInputSchema = z.object({ integrationId: z.string().min(1), slot: z.string().min(1) });

export interface FileChange {
  path: string;
  /** `null` deletes the file. */
  content: string | null;
}

export type Plan =
  | { kind: "noop"; message: string }
  | { kind: "reject"; failures: OperationFailure[] }
  | {
      kind: "change";
      files: FileChange[];
      /** A vendored package tarball to place in the repository before installing. */
      tarball: { path: string; base64: string } | null;
      /** Keeps the installed-integrations table in step once the change is applied. */
      onApplied: ((tx: Prisma.TransactionClient) => Promise<unknown>) | null;
    };

/** Tarballs travel to the sandbox base64-encoded in one environment variable, which Linux caps at 128 KiB. */
const MAX_VENDORED_BYTES = 90 * 1024;

/** The integration can't be installed as asked; reported as a rejection rather than an internal failure. */
class Unavailable extends Error {}

const CODE_FILES: PortfolioFile[] = ["app/layout.tsx", "app/page.tsx", "plinth.json"];

/**
 * Turns an install, uninstall or move into file changes for the safety net. It reads the staging worktree — the exact
 * commit the change will be applied on top of — runs the codemod engine, and adds or removes the package in
 * package.json. Installing the dependency, formatting, `plinth check`, `tsc`, applying and the render check are then
 * the same steps every edit goes through.
 */
@Injectable()
export class IntegrationPlanner {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SANDBOX_DRIVER) private readonly driver: SandboxDriver,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async plan(operation: Operation, externalId: string): Promise<Plan> {
    const read = (path: string) => this.driver.readFile(externalId, { root: "staging", path });
    const files = Object.fromEntries(await Promise.all(CODE_FILES.map(async (path) => [path, await read(path)]))) as PortfolioFiles;
    const packageJson = await read("package.json");

    try {
      switch (operation.type) {
        case "install":
          return await this.install(operation, files, packageJson);
        case "uninstall":
          return await this.uninstall(operation, files, packageJson);
        case "move":
          return await this.move(operation, files);
        default:
          throw new Error(`Not an integration operation: ${operation.type}`);
      }
    } catch (error) {
      if (error instanceof CodemodError) {
        return { kind: "reject", failures: [{ source: "codemod", code: error.code, message: error.message }] };
      }
      if (error instanceof Unavailable) return { kind: "reject", failures: [{ source: "install", message: error.message }] };
      throw error;
    }
  }

  private async install(operation: Operation, files: PortfolioFiles, packageJson: string): Promise<Plan> {
    const input = installInputSchema.parse(operation.input);
    const { manifest, tarball } = await this.catalogue(input.integrationId);
    const installed = (JSON.parse(files["plinth.json"]) as { integrations: unknown[] }).integrations.length;
    if (installed >= MAX_INSTALLED_INTEGRATIONS && !this.alreadyInstalled(files, manifest.id)) {
      return { kind: "reject", failures: [{ source: "install", message: `Your plan includes up to ${MAX_INSTALLED_INTEGRATIONS} integrations. Remove one to add another.` }] };
    }
    if (!manifest.allowedSlots.includes(input.slot as never)) {
      return { kind: "reject", failures: [{ source: "install", message: `${manifest.name} can't be placed in "${input.slot}".` }] };
    }

    const result = installIntegration(files, {
      id: manifest.id,
      package: manifest.package,
      version: manifest.version,
      slot: input.slot as never,
      component: manifest.component.import,
      kind: manifest.component.kind,
      props: input.props,
    });
    if (result.outcome === "already_installed") return { kind: "noop", message: `${manifest.name} is already installed.` };

    const spec = tarball ? `file:vendor/${basename(tarball.path)}` : manifest.version;
    const nextPackageJson = setDependency(packageJson, manifest.package, spec);
    return {
      kind: "change",
      files: [...changes(result), { path: "package.json", content: nextPackageJson }],
      tarball: tarball ? { path: `vendor/${basename(tarball.path)}`, base64: tarball.bytes.toString("base64") } : null,
      onApplied: (tx) =>
        tx.installedIntegration.upsert({
          where: { portfolioId_integrationId: { portfolioId: operation.portfolioId, integrationId: manifest.id } },
          create: { portfolioId: operation.portfolioId, integrationId: manifest.id, version: manifest.version, slot: input.slot, props: input.props },
          update: { version: manifest.version, slot: input.slot, props: input.props },
        }),
    };
  }

  private async uninstall(operation: Operation, files: PortfolioFiles, packageJson: string): Promise<Plan> {
    const input = uninstallInputSchema.parse(operation.input);
    const result = uninstallIntegration(files, input.integrationId);
    const forget = (tx: Prisma.TransactionClient) =>
      tx.installedIntegration.deleteMany({ where: { portfolioId: operation.portfolioId, integrationId: input.integrationId } });
    if (result.outcome === "not_installed" || !result.removed) return { kind: "noop", message: "That integration isn't installed." };

    const { next, removedSpec } = removeDependency(packageJson, result.removed.package);
    const vendored = removedSpec?.startsWith("file:vendor/") ? removedSpec.slice("file:".length) : null;
    return {
      kind: "change",
      files: [...changes(result), { path: "package.json", content: next }, ...(vendored ? [{ path: vendored, content: null }] : [])],
      tarball: null,
      onApplied: forget,
    };
  }

  private async move(operation: Operation, files: PortfolioFiles): Promise<Plan> {
    const input = moveInputSchema.parse(operation.input);
    const { manifest } = await this.catalogue(input.integrationId);
    if (!manifest.allowedSlots.includes(input.slot as never)) {
      return { kind: "reject", failures: [{ source: "install", message: `${manifest.name} can't be placed in "${input.slot}".` }] };
    }
    const result = moveIntegration(files, { id: manifest.id, to: input.slot as never, component: manifest.component.import, kind: manifest.component.kind });
    if (result.outcome === "not_installed") return { kind: "noop", message: `${manifest.name} isn't installed.` };
    if (result.outcome === "already_there") return { kind: "noop", message: `${manifest.name} is already in that slot.` };
    return {
      kind: "change",
      files: changes(result),
      tarball: null,
      onApplied: (tx) =>
        tx.installedIntegration.updateMany({ where: { portfolioId: operation.portfolioId, integrationId: manifest.id }, data: { slot: input.slot } }),
    };
  }

  private alreadyInstalled(files: PortfolioFiles, id: string) {
    return (JSON.parse(files["plinth.json"]) as { integrations: { id: string }[] }).integrations.some((entry) => entry.id === id);
  }

  private async catalogue(id: string): Promise<{ manifest: IntegrationManifest; tarball: { path: string; bytes: Buffer } | null }> {
    const row = await this.prisma.integration.findUnique({ where: { id } });
    const parsed = row ? validateManifest(row.manifest) : null;
    if (!row || !parsed?.ok) throw new Unavailable(`The integration "${id}" isn't in the catalogue.`);
    if (!row.tarball) return { manifest: parsed.manifest, tarball: null };
    const path = join(integrationsDir(this.config), row.tarball);
    const bytes = readFileSync(path);
    if (bytes.length > MAX_VENDORED_BYTES) throw new Unavailable(`${parsed.manifest.name} is too large to install from a vendored package.`);
    return { manifest: parsed.manifest, tarball: { path, bytes } };
  }
}

function changes(result: ProjectResult): FileChange[] {
  return result.changed.map((path) => ({ path, content: result.files[path] }));
}

/** Adds a dependency without reordering anything else, so removing it later restores package.json exactly. */
export function setDependency(text: string, pkg: string, spec: string): string {
  const json = JSON.parse(text) as { dependencies?: Record<string, string> };
  json.dependencies = { ...(json.dependencies ?? {}), [pkg]: spec };
  return `${JSON.stringify(json, null, 2)}\n`;
}

export function removeDependency(text: string, pkg: string): { next: string; removedSpec: string | null } {
  const json = JSON.parse(text) as { dependencies?: Record<string, string> };
  const removedSpec = json.dependencies?.[pkg] ?? null;
  if (json.dependencies) delete json.dependencies[pkg];
  return { next: `${JSON.stringify(json, null, 2)}\n`, removedSpec };
}
