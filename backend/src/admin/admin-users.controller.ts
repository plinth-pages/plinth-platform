import { Body, Controller, ForbiddenException, Get, Header, HttpCode, NotFoundException, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Prisma, User } from "@prisma/client";
import type { AdminUserSummary, AdminUsersResponse } from "@plinth-pages/shared";
import type { Response } from "express";
import { z } from "zod";
import { CurrentUser, Roles, RolesGuard } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { PrismaService } from "../prisma/prisma.service";

const PAGE_SIZE = 25;
const EXPORT_LIMIT = 10_000;

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  plan: z.enum(["free", "pro"]).optional(),
  role: z.enum(["user", "admin"]).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

const planBody = z.object({ plan: z.enum(["free", "pro"]) });
const roleBody = z.object({ role: z.enum(["user", "admin"]) });
const suspendBody = z.object({ suspended: z.boolean(), reason: z.string().trim().max(200).optional() });

/**
 * Who is using Plinth, and the switches an admin needs: give or take away Pro, grant or remove admin, and block or
 * restore access. Changing your own role or blocking yourself is refused, so an admin can't lock themselves out.
 */
@Controller("admin/users")
@UseGuards(SessionGuard, RolesGuard)
@Roles("admin")
export class AdminUsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() query: unknown): Promise<AdminUsersResponse> {
    const { q, plan, role, status, page } = listQuery.parse(query);
    const where: Prisma.UserWhereInput = {
      ...(plan ? { plan } : {}),
      ...(role ? { role } : {}),
      ...(status ? { suspendedAt: status === "suspended" ? { not: null } : null } : {}),
      ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { githubLogin: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {}),
    };
    const [rows, total, pro, suspended] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { _count: { select: { portfolios: true } } } }),
      this.prisma.user.count({ where }),
      this.prisma.user.count({ where: { plan: "pro" } }),
      this.prisma.user.count({ where: { suspendedAt: { not: null } } }),
    ]);
    return { users: rows.map(toSummary), total, page, pageSize: PAGE_SIZE, totals: { all: await this.prisma.user.count(), pro, suspended } };
  }

  /** The same list as a spreadsheet, for anything the table can't answer. */
  @Get("export.csv")
  @Header("content-type", "text/csv; charset=utf-8")
  @Header("content-disposition", 'attachment; filename="plinth-users.csv"')
  async export(@Res() res: Response): Promise<void> {
    const rows = await this.prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: EXPORT_LIMIT, include: { _count: { select: { portfolios: true } } } });
    const header = ["id", "name", "email", "handle", "signed_up_with", "plan", "subscription_status", "renews_at", "role", "status", "sites", "terms_accepted_at", "created_at"];
    const lines = rows.map((row) => {
      const user = toSummary(row);
      return [user.id, user.name, user.email, user.githubLogin, user.signedUpWith, user.plan, user.subscriptionStatus, user.renewsAt, user.role, user.suspendedAt ? "suspended" : "active", user.portfolios, user.termsAcceptedAt, user.createdAt]
        .map(csvCell)
        .join(",");
    });
    res.send([header.join(","), ...lines].join("\r\n"));
  }

  /** Give or take away Pro by hand — for partners, refunds and support. Stripe subscriptions are unaffected. */
  @Post(":id/plan")
  @HttpCode(200)
  async setPlan(@Param("id") id: string, @Body() body: unknown): Promise<{ user: AdminUserSummary }> {
    const { plan } = planBody.parse(body);
    return { user: toSummary(await this.update(id, { plan })) };
  }

  @Post(":id/role")
  @HttpCode(200)
  async setRole(@CurrentUser() admin: User, @Param("id") id: string, @Body() body: unknown): Promise<{ user: AdminUserSummary }> {
    const { role } = roleBody.parse(body);
    if (id === admin.id) throw new ForbiddenException("You can't change your own role.");
    return { user: toSummary(await this.update(id, { role })) };
  }

  /** Blocks or restores access. A blocked user is signed out everywhere on their next request. */
  @Post(":id/suspend")
  @HttpCode(200)
  async suspend(@CurrentUser() admin: User, @Param("id") id: string, @Body() body: unknown): Promise<{ user: AdminUserSummary }> {
    const { suspended, reason } = suspendBody.parse(body);
    if (id === admin.id) throw new ForbiddenException("You can't block your own account.");
    return { user: toSummary(await this.update(id, { suspendedAt: suspended ? new Date() : null, suspendedReason: suspended ? (reason ?? null) : null })) };
  }

  private async update(id: string, data: Prisma.UserUpdateInput) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found.");
    return this.prisma.user.update({ where: { id }, data, include: { _count: { select: { portfolios: true } } } });
  }
}

type UserRow = User & { _count?: { portfolios: number } };

function toSummary(row: UserRow): AdminUserSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    githubLogin: row.githubLogin,
    signedUpWith: row.githubId ? "github" : "email",
    plan: row.plan,
    role: row.role,
    subscriptionStatus: row.subscriptionStatus,
    renewsAt: row.planRenewsAt?.toISOString() ?? null,
    cancelsAtPeriodEnd: row.planCancelsAtPeriodEnd,
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    suspendedReason: row.suspendedReason,
    portfolios: row._count?.portfolios ?? 0,
    termsAcceptedAt: row.termsAcceptedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Quotes a value for CSV, and stops a leading =, +, - or @ being run as a formula by a spreadsheet. */
function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
