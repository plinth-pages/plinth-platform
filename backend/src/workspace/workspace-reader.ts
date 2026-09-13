import { Inject, Injectable } from "@nestjs/common";
import type {
  ContractCheckResponse,
  SlotsResponse,
  WorkspaceFileResponse,
  WorkspaceTreeResponse,
} from "@plinth-pages/shared";
import { UnrecoverableError } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { SANDBOX_DRIVER, SandboxNotRunningError, type SandboxDriver } from "../sandbox/sandbox-driver";
import { isViewable, viewablePath } from "./workspace-policy";
import { MAX_TREE_ENTRIES, MAX_VIEWABLE_BYTES, WORKSPACE_ERROR } from "./workspace.constants";

const READ_TIMEOUT_MS = 20_000;
const CHECK_TIMEOUT_MS = 90_000;

/** Worker only: answers read-only questions about a portfolio's running workspace. Never writes. */
@Injectable()
export class WorkspaceReader {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SANDBOX_DRIVER) private readonly driver: SandboxDriver,
  ) {}

  async tree(portfolioId: string): Promise<WorkspaceTreeResponse> {
    const result = await this.exec(portfolioId, "git ls-files --cached --others --exclude-standard -z", READ_TIMEOUT_MS);
    const files = result.stdout.split("\0").filter((path) => path && isViewable(path)).sort();
    return { files: files.slice(0, MAX_TREE_ENTRIES), truncated: files.length > MAX_TREE_ENTRIES };
  }

  async file(portfolioId: string, requested: string): Promise<WorkspaceFileResponse> {
    const path = this.policy(requested);
    // Resolve symlinks inside the sandbox and check the real target against the same policy.
    const probe = await this.exec(
      portfolioId,
      `real=$(realpath -e --relative-to=. -- ${sh(path)}) && [ -f "$real" ] && printf '%s\\n' "$real" && stat -c %s -- "$real"`,
      READ_TIMEOUT_MS,
    );
    if (probe.exitCode !== 0) throw new UnrecoverableError(`${WORKSPACE_ERROR.notFound}: ${path}`);
    const [real, sizeText] = probe.stdout.trim().split("\n");
    this.policy(real);

    const size = Number(sizeText);
    if (size > MAX_VIEWABLE_BYTES) return { path, kind: "too_large", content: null, size };
    const content = await this.call(portfolioId, (externalId) => this.driver.readFile(externalId, real));
    if (content.includes("\0") || /�{3,}/.test(content)) return { path, kind: "binary", content: null, size };
    return { path, kind: "file", content, size };
  }

  async slots(portfolioId: string): Promise<SlotsResponse> {
    // Read the slot vocabulary from the package the portfolio actually has installed, not from the platform's copy.
    const script = [
      `import { SLOTS } from "@plinth-pages/core/slots";`,
      `import { readFileSync } from "node:fs";`,
      `let plinth = null; try { plinth = JSON.parse(readFileSync("plinth.json", "utf8")); } catch {}`,
      `process.stdout.write(JSON.stringify({ SLOTS, plinth }));`,
    ].join(" ");
    const result = await this.exec(portfolioId, `node --input-type=module -e ${sh(script)}`, READ_TIMEOUT_MS);
    if (result.exitCode !== 0) throw new Error(`Could not read the slot contract: ${result.stderr.trim().slice(-300)}`);

    const { SLOTS, plinth } = JSON.parse(result.stdout) as {
      SLOTS: Record<string, { file: string; description: string; bare?: boolean; wraps?: boolean }>;
      plinth: { coreVersion?: string; slotsVersion?: number; integrations?: { id: string; slot: string }[] } | null;
    };
    const integrations = plinth?.integrations ?? [];
    return {
      coreVersion: plinth?.coreVersion ?? null,
      slotsVersion: plinth?.slotsVersion ?? null,
      slots: Object.entries(SLOTS).map(([name, slot]) => ({
        name,
        file: slot.file,
        description: slot.description,
        bare: Boolean(slot.bare),
        wraps: Boolean(slot.wraps),
        integrations: integrations.filter((i) => i.slot === name).map((i) => i.id),
      })),
    };
  }

  /** Runs `plinth check`, the slot contract validator. Read-only: it parses files and reports. */
  async check(portfolioId: string): Promise<ContractCheckResponse> {
    const started = Date.now();
    const result = await this.exec(portfolioId, "pnpm exec plinth check --json", CHECK_TIMEOUT_MS);
    try {
      const parsed = JSON.parse(result.stdout) as { ok: boolean; issues: ContractCheckResponse["issues"] };
      return { ok: parsed.ok, issues: parsed.issues, durationMs: Date.now() - started };
    } catch {
      throw new Error(`plinth check did not produce a report: ${(result.stderr || result.stdout).trim().slice(-300)}`);
    }
  }

  private policy(path: string): string {
    try {
      return viewablePath(path);
    } catch {
      throw new UnrecoverableError(`${WORKSPACE_ERROR.refused}: ${path}`);
    }
  }

  private exec(portfolioId: string, command: string, timeoutMs: number) {
    return this.call(portfolioId, (externalId) => this.driver.exec(externalId, command, { cwd: ".", envs: {}, timeoutMs }));
  }

  private async call<T>(portfolioId: string, use: (externalId: string) => Promise<T>): Promise<T> {
    const sandbox = await this.prisma.sandbox.findUnique({ where: { portfolioId }, select: { status: true, externalId: true } });
    if (sandbox?.status !== "running" || !sandbox.externalId) throw new UnrecoverableError(WORKSPACE_ERROR.notRunning);
    try {
      return await use(sandbox.externalId);
    } catch (error) {
      if (error instanceof SandboxNotRunningError) throw new UnrecoverableError(WORKSPACE_ERROR.notRunning);
      throw error;
    }
  }
}

function sh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
