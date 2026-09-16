import { InjectQueue } from "@nestjs/bullmq";
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, type Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpAdapterHost } from "@nestjs/core";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { SANDBOX_QUEUE, enqueueSandboxJob, type SandboxJobData } from "../sandbox/sandbox.constants";
import { PreviewProxy } from "./preview-proxy";
import { PreviewSessions, PreviewUrls } from "./preview-sessions";

export const PREVIEW_SESSIONS = Symbol("PREVIEW_SESSIONS");
export const PREVIEW_URLS = Symbol("PREVIEW_URLS");

/** Api only: starts the preview proxy next to the HTTP API. */
@Injectable()
export class PreviewProxyHost implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PreviewProxy.name);
  private proxy?: PreviewProxy;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(PREVIEW_SESSIONS) private readonly sessions: PreviewSessions,
    @Inject(PREVIEW_URLS) private readonly urls: PreviewUrls,
    @InjectQueue(SANDBOX_QUEUE) private readonly queue: Queue<SandboxJobData>,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  async onApplicationBootstrap() {
    this.proxy = new PreviewProxy({
      urls: this.urls,
      resolveSession: (label) => this.sessions.resolve(label),
      findTarget: (portfolioId) =>
        this.prisma.sandbox.findUnique({ where: { portfolioId }, select: { status: true, previewUrl: true, trafficToken: true } }),
      wake: async (portfolioId) => void (await enqueueSandboxJob(this.queue, "ensure", portfolioId)),
      frameAncestors: [this.config.get("ADMIN_URL", { infer: true })],
      hostHeader: this.config.get("PREVIEW_HOST_HEADER", { infer: true }),
      logger: this.logger,
      cacheMs: 2_000,
    });
    const port = this.config.get("PREVIEW_PROXY_PORT", { infer: true });
    await this.proxy.listen(port);
    this.logger.log(`Preview proxy listening on :${port} (${this.urls.url("{session}")})`);

    // Behind an edge that marks preview requests, also take them on the API's own port: hosts like Railway expose only
    // one public port per service.
    const hostHeader = this.config.get("PREVIEW_HOST_HEADER", { infer: true });
    if (hostHeader) {
      this.proxy.attach(this.adapterHost.httpAdapter.getHttpServer());
      this.logger.log(`Preview proxy also serving the API port for requests with ${hostHeader}`);
    }
  }

  async onApplicationShutdown() {
    await this.proxy?.close();
  }
}

export const previewApiProviders: Provider[] = [
  PreviewProxyHost,
  {
    provide: PREVIEW_URLS,
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>) => new PreviewUrls(config.get("PREVIEW_URL_TEMPLATE", { infer: true })),
  },
  {
    provide: PREVIEW_SESSIONS,
    inject: [getQueueToken(SANDBOX_QUEUE)],
    // The sandbox queue's connection is an ioredis client; sessions only need get/set/expire on it.
    useFactory: (queue: Queue) => new PreviewSessions(async () => (await queue.client) as never),
  },
];
