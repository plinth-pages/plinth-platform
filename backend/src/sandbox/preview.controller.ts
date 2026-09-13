import { Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { PreviewResponse } from "@plinth-pages/shared";
import { CurrentUser } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { PreviewService } from "./preview.service";

@Controller("portfolios/:id/preview")
@UseGuards(SessionGuard)
export class PreviewController {
  constructor(private readonly previews: PreviewService) {}

  @Get()
  async status(@CurrentUser() user: User, @Param("id") id: string): Promise<PreviewResponse> {
    return { preview: await this.previews.status(user, id) };
  }

  /** Open the preview, or keep it awake. The IDE calls this on load and every 30 seconds while visible. */
  @Post()
  @HttpCode(200)
  async open(@CurrentUser() user: User, @Param("id") id: string): Promise<PreviewResponse> {
    return { preview: await this.previews.open(user, id) };
  }

  @Post("restart")
  @HttpCode(202)
  async restart(@CurrentUser() user: User, @Param("id") id: string): Promise<PreviewResponse> {
    return { preview: await this.previews.restart(user, id) };
  }

  @Post("rebuild")
  @HttpCode(202)
  async rebuild(@CurrentUser() user: User, @Param("id") id: string): Promise<PreviewResponse> {
    return { preview: await this.previews.rebuild(user, id) };
  }
}
