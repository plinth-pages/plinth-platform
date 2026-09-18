import { Controller, Get, HttpCode, NotFoundException, Optional, Param, Post, Req, Res } from "@nestjs/common";
import { HttpException, HttpStatus } from "@nestjs/common";
import { createHash } from "crypto";
import type { Request, Response } from "express";
import { Alerts } from "../observability/alerts";
import { PrismaService } from "../prisma/prisma.service";

const SITE_ID = /^[a-z0-9]{20,40}$/;
/** A browser counts once per session already; this stops a reload loop counting from one address. */
const DEDUPE_MS = 30 * 60_000;
const RATE_PER_MINUTE = 60;

/**
 * Public, unauthenticated counter behind the Visitor Counter integration. It only counts for portfolios that have the
 * integration installed, stores nothing about visitors (addresses are hashed in memory, never saved), and answers any
 * origin because it is called from published sites.
 */
@Controller("public/counter")
export class VisitorCounterController {
  private readonly seen = new Map<string, number>();
  private readonly rate = new Map<string, { minute: number; hits: number }>();
  private readonly enabled = new Map<string, { value: boolean; until: number }>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly alerts?: Alerts,
  ) {}

  @Get(":siteId")
  async read(@Param("siteId") siteId: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.headers(res);
    await this.guard(siteId, req);
    const row = await this.prisma.visitorCount.findUnique({ where: { portfolioId: siteId } });
    return { count: row?.count ?? 0 };
  }

  @Post(":siteId")
  @HttpCode(200)
  async hit(@Param("siteId") siteId: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.headers(res);
    const visitor = await this.guard(siteId, req);
    const key = `${siteId}:${visitor}`;
    const now = Date.now();
    if ((this.seen.get(key) ?? 0) > now - DEDUPE_MS) {
      const row = await this.prisma.visitorCount.findUnique({ where: { portfolioId: siteId } });
      return { count: row?.count ?? 0 };
    }
    this.seen.set(key, now);
    if (this.seen.size > 50_000) this.seen.clear();
    const row = await this.prisma.visitorCount.upsert({
      where: { portfolioId: siteId },
      create: { portfolioId: siteId, count: 1 },
      update: { count: { increment: 1 } },
    });
    return { count: row.count };
  }

  private headers(res: Response) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.removeHeader("Access-Control-Allow-Credentials");
    res.setHeader("Cache-Control", "no-store");
  }

  /** Validates the site and rate-limits the caller. Returns an in-memory visitor hash (never stored). */
  private async guard(siteId: string, req: Request): Promise<string> {
    if (!SITE_ID.test(siteId) || !(await this.isEnabled(siteId))) throw new NotFoundException();
    const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.socket.remoteAddress ?? "unknown").trim();
    const visitor = createHash("sha256").update(ip).digest("hex").slice(0, 16);
    const minute = Math.floor(Date.now() / 60_000);
    const bucket = this.rate.get(visitor);
    if (bucket?.minute === minute) {
      if (++bucket.hits > RATE_PER_MINUTE) throw new HttpException("Too many requests", HttpStatus.TOO_MANY_REQUESTS);
    } else {
      this.rate.set(visitor, { minute, hits: 1 });
      if (this.rate.size > 50_000) this.rate.clear();
    }
    return visitor;
  }

  private async isEnabled(siteId: string): Promise<boolean> {
    const cached = this.enabled.get(siteId);
    if (cached && cached.until > Date.now()) return cached.value;
    const value = (await this.prisma.installedIntegration.count({ where: { portfolioId: siteId, integrationId: "visitor-counter" } })) > 0;
    // A published site asking for a count we refuse to give means its owner sees nothing where they installed a
    // counter — and the component hides itself, so nobody would ever hear about it.
    if (!value) await this.reportOrphan(siteId);
    this.enabled.set(siteId, { value, until: Date.now() + 5 * 60_000 });
    if (this.enabled.size > 10_000) this.enabled.clear();
    return value;
  }

  /** Only worth reporting for a site we actually host — a random or stale id is just noise. */
  private async reportOrphan(siteId: string): Promise<void> {
    if (!this.alerts?.configured) return;
    const portfolio = await this.prisma.portfolio.findUnique({ where: { id: siteId }, select: { slug: true } });
    if (!portfolio) return;
    this.alerts.send({
      title: "A published site is asking for a visitor count it can't have",
      level: "warning",
      dedupeKey: `counter:orphan:${siteId}`,
      fields: {
        portfolio: siteId,
        site: portfolio.slug,
        problem: "The site renders the Visitor Counter but has no installed_integration row, so the counter hides itself and the owner sees nothing.",
      },
    });
  }
}
