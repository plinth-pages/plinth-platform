import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { CopilotMessagesResponse, CopilotModelsResponse, SendCopilotMessageResponse } from "@plinth-pages/shared";
import { CurrentUser } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { CopilotService } from "./copilot.service";

@Controller()
@UseGuards(SessionGuard)
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Get("copilot/models")
  models(@CurrentUser() user: User): CopilotModelsResponse {
    return this.copilot.models(user);
  }

  @Get("portfolios/:id/copilot/messages")
  list(@CurrentUser() user: User, @Param("id") id: string): Promise<CopilotMessagesResponse> {
    return this.copilot.list(user, id);
  }

  /** Records the message and queues the change; the reply arrives with the operation's events. */
  @Post("portfolios/:id/copilot/messages")
  @HttpCode(202)
  send(@CurrentUser() user: User, @Param("id") id: string, @Body() body: unknown): Promise<SendCopilotMessageResponse> {
    return this.copilot.send(user, id, body);
  }
}
