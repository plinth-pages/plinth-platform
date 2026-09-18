import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CopilotMessage, Operation, User } from "@prisma/client";
import type { CopilotChanges, CopilotMessageSummary, CopilotMessagesResponse, CopilotUsage, OperationFailure, SendCopilotMessageResponse } from "@plinth-pages/shared";
import { z } from "zod";
import { AiService, DEFAULT_MODEL_ID } from "../ai/ai.service";
import type { Env } from "../config/env";
import { OperationsService } from "../operations/operations.service";
import { PrismaService } from "../prisma/prisma.service";
import { MAX_REQUEST_CHARS, PLANS } from "../billing/plans";

export const PREMIUM_REQUIRED = "This model is part of Pro. Upgrade to use it.";
const DAY_MS = 24 * 60 * 60_000;
const ACTIVE = ["queued", "staging", "checking", "applying"] as const;

const sendBody = z.object({
  message: z.string().trim().min(1, "Type what you'd like to change.").max(MAX_REQUEST_CHARS, `Keep it under ${MAX_REQUEST_CHARS} characters.`),
  model: z.string().max(64).optional(),
});

/** Api side of Plinth AI: records the message and queues a `copilot` operation. The worker talks to the model. */
@Injectable()
export class CopilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operations: OperationsService,
    private readonly ai: AiService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  models(user: User) {
    return { models: this.ai.catalogue(user.plan) };
  }

  async list(user: User, portfolioId: string): Promise<CopilotMessagesResponse> {
    await this.owned(user, portfolioId);
    const rows = await this.prisma.copilotMessage.findMany({ where: { portfolioId }, orderBy: { createdAt: "desc" }, take: 60 });
    rows.reverse();
    const operationIds = [...new Set(rows.map((row) => row.operationId).filter((id): id is string => Boolean(id)))];
    const operations = new Map(
      (await this.prisma.operation.findMany({ where: { id: { in: operationIds } } })).map((operation) => [operation.id, operation]),
    );
    return { messages: rows.map((row) => toMessage(row, row.operationId ? operations.get(row.operationId) : undefined)), usage: await this.usage(user) };
  }

  async send(user: User, portfolioId: string, body: unknown): Promise<SendCopilotMessageResponse> {
    const portfolio = await this.owned(user, portfolioId);
    if (portfolio.status !== "ready") throw new ConflictException("Your portfolio is still being set up.");
    const parsed = sendBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid message");

    const model = this.ai.findModel(parsed.data.model ?? DEFAULT_MODEL_ID);
    if (!model || model.hidden) throw new BadRequestException("Choose a model from the list.");
    if (model.tier === "pro" && user.plan !== "pro") throw new ForbiddenException({ statusCode: 403, code: "PREMIUM_REQUIRED", message: PREMIUM_REQUIRED });
    if (!this.ai.catalogue(user.plan).find((entry) => entry.id === model.id)?.available) {
      throw new ServiceUnavailableException(`${model.label} isn't available right now. Please try again later.`);
    }

    const usage = await this.usage(user);
    const upgrade = user.plan === "free" ? " Upgrade to Pro for much more room." : "";
    if (parsed.data.message.length > usage.maxRequestChars) {
      throw new HttpException(
        {
          statusCode: 413,
          code: "REQUEST_TOO_LARGE",
          message: `That request is longer than your plan allows (${usage.maxRequestChars.toLocaleString("en")} characters). Split it into smaller steps.${upgrade}`,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    if (usage.tokensUsed >= usage.tokenLimit) {
      throw new HttpException({ statusCode: 429, code: "TOKEN_LIMIT", message: `You've used this month's Plinth AI allowance.${upgrade || " It refreshes over the next 30 days."}` }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (usage.dailyTokensUsed >= usage.dailyTokenLimit) {
      throw new HttpException({ statusCode: 429, code: "DAILY_LIMIT", message: `You've used today's Plinth AI allowance.${upgrade || " It refreshes over the next 24 hours."}` }, HttpStatus.TOO_MANY_REQUESTS);
    }
    // One request at a time per portfolio keeps the conversation in order and the preview from queueing up edits.
    const busy = await this.prisma.operation.count({ where: { portfolioId, type: "copilot", status: { in: [...ACTIVE] } } });
    if (busy) throw new ConflictException("Plinth AI is still working on your last request.");

    const message = await this.prisma.copilotMessage.create({
      data: { portfolioId, userId: user.id, role: "user", content: parsed.data.message, model: model.id },
    });
    const summary = parsed.data.message.replace(/\s+/g, " ").slice(0, 72);
    const operation = await this.operations.enqueue(portfolioId, "copilot", summary, { messageId: message.id, model: model.id }, "copilot");
    const linked = await this.prisma.copilotMessage.update({ where: { id: message.id }, data: { operationId: operation.id } });
    return { message: toMessage(linked, undefined, operation.status), operation };
  }

  /** Tokens used in the last 24 hours and the last 30 days, against the user's plan. */
  private async usage(user: User): Promise<CopilotUsage> {
    const limits = PLANS[user.plan].limits;
    const tokensSince = async (ms: number) => {
      const sum = await this.prisma.copilotMessage.aggregate({
        where: { userId: user.id, role: "assistant", createdAt: { gte: new Date(Date.now() - ms) } },
        _sum: { inputTokens: true, outputTokens: true },
      });
      return (sum._sum.inputTokens ?? 0) + (sum._sum.outputTokens ?? 0);
    };
    const [today, month] = await Promise.all([tokensSince(DAY_MS), tokensSince(30 * DAY_MS)]);
    return {
      plan: user.plan,
      dailyTokensUsed: today,
      dailyTokenLimit: limits.dailyTokens,
      tokensUsed: month,
      tokenLimit: limits.monthlyTokens,
      maxRequestChars: limits.maxRequestChars,
    };
  }

  private async owned(user: User, portfolioId: string) {
    const portfolio = await this.prisma.portfolio.findFirst({ where: { id: portfolioId, userId: user.id }, select: { id: true, status: true } });
    if (!portfolio) throw new NotFoundException("Portfolio not found");
    return portfolio;
  }
}

function toMessage(row: CopilotMessage, operation?: Operation, fallbackStatus?: Operation["status"]): CopilotMessageSummary {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    model: row.model,
    refused: row.refused,
    changes: (row.changes as CopilotChanges | null) ?? null,
    operation: row.operationId
      ? {
          id: row.operationId,
          status: operation?.status ?? fallbackStatus ?? "queued",
          failures: ((operation?.checkOutput as OperationFailure[] | null) ?? []).slice(0, 5),
          error: operation?.error ?? null,
        }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}
