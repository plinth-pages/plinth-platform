import { Body, Controller, Get, HttpCode, Ip, Post, Req, UseGuards, BadRequestException, HttpException, HttpStatus } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AuthService } from "../auth/auth.service";
import { Roles, RolesGuard } from "../auth/roles";
import { SESSION_COOKIE } from "../auth/session";
import { SessionGuard } from "../auth/session.guard";
import { PrismaService } from "../prisma/prisma.service";

const requestSchema = z.object({
  kind: z.enum(["access", "correction", "deletion", "consent_withdrawal", "grievance", "other"]),
  name: z.string().trim().min(1, "Tell us your name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  message: z.string().trim().min(10, "Tell us a little more (at least 10 characters).").max(5000),
});

const WINDOW_MS = 60 * 60_000;
const MAX_PER_WINDOW = 5;

/**
 * Privacy and legal requests. Plinth publishes no contact address, so this form is the channel the Privacy Policy
 * points to (including for grievances under India's DPDP Act). Requests land in /admin.
 */
@Controller()
export class LegalController {
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  @Post("legal/requests")
  @HttpCode(201)
  async create(@Body() body: unknown, @Ip() ip: string, @Req() req: Request) {
    // Behind Railway's proxy the socket address is the proxy's; the client is the first forwarded hop.
    const forwarded = req.headers["x-forwarded-for"];
    this.throttle((Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0].trim() || ip);
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[String(issue.path[0])] ??= issue.message;
      throw new BadRequestException({ statusCode: 400, message: Object.values(fields)[0], fields });
    }
    // Signed in or not, anyone may write; a session just links the request to the account.
    const user = await this.auth.userFromSession(req.cookies?.[SESSION_COOKIE]);
    const created = await this.prisma.legalRequest.create({ data: { ...parsed.data, userId: user?.id ?? null } });
    return { id: created.id, receivedAt: created.createdAt.toISOString() };
  }

  @Get("admin/legal-requests")
  @UseGuards(SessionGuard, RolesGuard)
  @Roles("admin")
  async list() {
    const requests = await this.prisma.legalRequest.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    return {
      requests: requests.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        email: r.email,
        message: r.message,
        signedIn: Boolean(r.userId),
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
      })),
    };
  }

  @Post("admin/legal-requests/resolve")
  @HttpCode(204)
  @UseGuards(SessionGuard, RolesGuard)
  @Roles("admin")
  async resolve(@Body() body: { id?: string }) {
    if (!body?.id) throw new BadRequestException("Missing request id.");
    await this.prisma.legalRequest.update({ where: { id: body.id }, data: { resolvedAt: new Date() } });
  }

  private throttle(ip: string) {
    const now = Date.now();
    const times = (this.recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    if (times.length >= MAX_PER_WINDOW) {
      throw new HttpException("Too many requests from here. Please try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
    times.push(now);
    this.recent.set(ip, times);
  }
}
