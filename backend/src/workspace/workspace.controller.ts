import { Controller, Get, MessageEvent, NotFoundException, Param, Post, Query, Sse, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type {
  ContractCheckResponse,
  SlotsResponse,
  WorkspaceFileResponse,
  WorkspaceTreeResponse,
} from "@plinth-pages/shared";
import { interval, map, merge, type Observable } from "rxjs";
import { CurrentUser } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { PortfolioEventsHub } from "../events/portfolio-events.hub";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspaceService } from "./workspace.service";

/** The editor's read-only view of a portfolio: files, slots, the contract check, and live events. */
@Controller("portfolios/:id")
@UseGuards(SessionGuard)
export class WorkspaceController {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly events: PortfolioEventsHub,
    private readonly prisma: PrismaService,
  ) {}

  @Get("files")
  tree(@CurrentUser() user: User, @Param("id") id: string): Promise<WorkspaceTreeResponse> {
    return this.workspace.tree(user, id);
  }

  @Get("files/content")
  file(@CurrentUser() user: User, @Param("id") id: string, @Query("path") path?: string): Promise<WorkspaceFileResponse> {
    return this.workspace.file(user, id, path);
  }

  @Get("slots")
  slots(@CurrentUser() user: User, @Param("id") id: string): Promise<SlotsResponse> {
    return this.workspace.slots(user, id);
  }

  @Post("slots/check")
  check(@CurrentUser() user: User, @Param("id") id: string): Promise<ContractCheckResponse> {
    return this.workspace.check(user, id);
  }

  /** Server-sent events. A comment-free `ping` every 25 s keeps proxies from closing an idle stream. */
  @Sse("events")
  async stream(@CurrentUser() user: User, @Param("id") id: string): Promise<Observable<MessageEvent>> {
    const portfolio = await this.prisma.portfolio.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!portfolio) throw new NotFoundException("Portfolio not found");
    return merge(
      this.events.stream(portfolio.id).pipe(map((event) => ({ data: event }))),
      interval(25_000).pipe(map(() => ({ data: { type: "ping" } }))),
    );
  }
}
