import { InjectQueue } from "@nestjs/bullmq";
import {
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { User } from "@prisma/client";
import type {
  ContractCheckResponse,
  SlotsResponse,
  WorkspaceFileResponse,
  WorkspaceTreeResponse,
} from "@plinth-pages/shared";
import { QueueEvents, type Queue } from "bullmq";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { redisConnection } from "../queue/redis-connection";
import { RefusedPathError, viewablePath } from "./workspace-policy";
import { WORKSPACE_ERROR, WORKSPACE_QUEUE, type WorkspaceJob } from "./workspace.constants";

/** Api side of workspace reads: checks ownership and path policy, then asks the worker and waits for the answer. */
@Injectable()
export class WorkspaceService implements OnModuleDestroy {
  private events?: QueueEvents;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue(WORKSPACE_QUEUE) private readonly queue: Queue,
  ) {}

  async tree(user: User, portfolioId: string): Promise<WorkspaceTreeResponse> {
    await this.owned(user, portfolioId);
    return this.ask({ name: "tree", data: { portfolioId } }, 25_000);
  }

  async file(user: User, portfolioId: string, requested: string | undefined): Promise<WorkspaceFileResponse> {
    await this.owned(user, portfolioId);
    let path: string;
    try {
      path = viewablePath(requested ?? "");
    } catch (error) {
      if (error instanceof RefusedPathError) throw refused(error.path);
      throw error;
    }
    return this.ask({ name: "file", data: { portfolioId, path } }, 25_000);
  }

  async slots(user: User, portfolioId: string): Promise<SlotsResponse> {
    await this.owned(user, portfolioId);
    return this.ask({ name: "slots", data: { portfolioId } }, 25_000);
  }

  async check(user: User, portfolioId: string): Promise<ContractCheckResponse> {
    await this.owned(user, portfolioId);
    return this.ask({ name: "check", data: { portfolioId } }, 100_000);
  }

  /** Reads GitHub through the worker; the sandbox does not need to be running. */
  publishState(portfolioId: string): Promise<{ unpublishedCount: number; draftSha: string | null; mainSha: string | null }> {
    return this.ask({ name: "publish-state", data: { portfolioId } }, 25_000);
  }

  async onModuleDestroy() {
    await this.events?.close();
  }

  private async ask<T>(job: WorkspaceJob, timeoutMs: number): Promise<T> {
    this.events ??= new QueueEvents(WORKSPACE_QUEUE, { connection: redisConnection(this.config.get("REDIS_URL", { infer: true })) });
    await this.events.waitUntilReady();

    const queued = await this.queue.add(job.name, job.data, {
      // The answer is read once, straight away; keep it only long enough for that.
      removeOnComplete: { age: 60 },
      removeOnFail: { age: 60 },
    });
    try {
      return (await queued.waitUntilFinished(this.events, timeoutMs)) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith(WORKSPACE_ERROR.notRunning)) {
        throw new ConflictException({
          statusCode: 409,
          code: WORKSPACE_ERROR.notRunning,
          message: "The preview isn't running. It will be readable once it has started.",
        });
      }
      if (message.startsWith(WORKSPACE_ERROR.refused)) throw refused(message.slice(WORKSPACE_ERROR.refused.length + 2));
      if (message.startsWith(WORKSPACE_ERROR.notFound)) throw new NotFoundException("That file doesn't exist in the workspace.");
      if (/timed out before finishing/i.test(message)) throw new GatewayTimeoutException("The workspace took too long to answer.");
      throw new ServiceUnavailableException(`The workspace could not be read: ${message}`);
    }
  }

  private async owned(user: User, portfolioId: string) {
    const portfolio = await this.prisma.portfolio.findFirst({ where: { id: portfolioId, userId: user.id }, select: { id: true } });
    if (!portfolio) throw new NotFoundException("Portfolio not found");
  }
}

function refused(path: string) {
  return new ForbiddenException({
    statusCode: 403,
    code: WORKSPACE_ERROR.refused,
    message: `${path} can't be opened in the code viewer. Secrets, git internals and installed packages are never shown.`,
  });
}
