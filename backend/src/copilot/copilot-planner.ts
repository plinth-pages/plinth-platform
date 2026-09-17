import { Injectable, Logger } from "@nestjs/common";
import type { CopilotChanges, OperationFailure } from "@plinth-pages/shared";
import type { Operation, Prisma } from "@prisma/client";
import { z } from "zod";
import { AiProviderError, tooLarge } from "../ai/ai-provider";
import { AiService, type RequestBuilder } from "../ai/ai.service";
import { CatalogueService } from "../catalogue/catalogue.service";
import type { FollowUp, Plan } from "../operations/integration-planner";
import { OperationAborted } from "../operations/operation-errors";
import { PrismaService } from "../prisma/prisma.service";
import { CopilotEditError, applyEdits, copilotOutputSchema, type CopilotOutput } from "./copilot-plan";
import { selectContext } from "./copilot-context";
import { SUBMIT_CHANGES_TOOL, SYSTEM_PROMPT, buildUserTurn, type ContextFile } from "./copilot-prompt";

export const copilotInputSchema = z.object({ messageId: z.string().min(1), model: z.string().min(1) });

/** How many earlier messages are sent as conversation history. */
const HISTORY_MESSAGES = 4;
/** Earlier messages are context, not content to re-edit; long ones are cut short to save tokens. */
const HISTORY_CHARS = 600;

const AI_TIMEOUT_MS = 90_000;


/** Runs one context read (the `context` script in the staging tree). Supplied by the runner. */
export type ContextReader = () => Promise<{ files: ContextFile[]; truncated: boolean }>;

export function parseContext(output: string): { files: ContextFile[]; truncated: boolean } {
  // The script reports truncation after the last file it printed; strip it so it isn't read as file content.
  const truncated = /\nPLINTH_TRUNCATED=1\n?$/.test(output);
  const stdout = truncated ? output.replace(/PLINTH_TRUNCATED=1\n?$/, "") : output;
  const marks = [...stdout.matchAll(/^---PLINTH:file:(.+)---$/gm)];
  const files = marks.map((mark, index) => {
    const start = mark.index! + mark[0].length + 1;
    const end = index + 1 < marks.length ? marks[index + 1].index! : stdout.length;
    return { path: mark[1], content: stdout.slice(start, end).replace(/\n$/, "") };
  });
  return { files, truncated };
}

/**
 * Worker: turns a chat message into a plan for the safety net. The model sees the staging worktree — exactly the
 * commit its edits will be applied to — and answers with a structured tool call, which is validated and applied
 * here. Nothing the model says is executed or written without passing copilot-plan.ts first, then the normal checks.
 */
@Injectable()
export class CopilotPlanner {
  private readonly logger = new Logger(CopilotPlanner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly catalogue: CatalogueService,
  ) {}

  async plan(operation: Operation, readContext: ContextReader): Promise<Plan> {
    const input = copilotInputSchema.parse(operation.input);
    const message = await this.prisma.copilotMessage.findUnique({ where: { id: input.messageId } });
    if (!message || message.portfolioId !== operation.portfolioId) throw new OperationAborted("The message for this change is missing.");

    const [history, context, available, installed] = await Promise.all([
      this.prisma.copilotMessage.findMany({
        where: { portfolioId: operation.portfolioId, createdAt: { lt: message.createdAt } },
        orderBy: { createdAt: "desc" },
        take: HISTORY_MESSAGES,
      }),
      readContext(),
      this.catalogue.list(),
      this.prisma.installedIntegration.findMany({ where: { portfolioId: operation.portfolioId }, select: { integrationId: true, slot: true } }),
    ]);

    const placed = installed.map((row) => ({ id: row.integrationId, slot: row.slot }));
    const previous = history.reverse().map((entry) => ({ role: entry.role, text: entry.content.length > HISTORY_CHARS ? `${entry.content.slice(0, HISTORY_CHARS)}…` : entry.content }));
    // Built per attempt: a fallback model gets context sized for itself, and each call its own timeout.
    const build: RequestBuilder = (_model, contextChars) => {
      const selected = selectContext(context.files, message.content, contextChars);
      return {
        system: SYSTEM_PROMPT,
        messages: [...previous, { role: "user" as const, text: buildUserTurn(message.content, selected.included, available, placed, selected.omitted) }],
        tool: SUBMIT_CHANGES_TOOL,
        temperature: 0.2,
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      };
    };

    const started = Date.now();
    let result: Awaited<ReturnType<AiService["generate"]>>;
    try {
      result = await this.ai.generate(input.model, build);
    } catch (error) {
      const text = tooLarge(error)
        ? "That request is too big for this model to handle in one go. Try asking for one change at a time, or switch to a larger model on Pro."
        : error instanceof AiProviderError && error.retryable
          ? "Plinth AI is busy right now. Please try again in a moment."
          : "Plinth AI isn't available right now. Please try again later.";
      this.logger.warn(`Plinth AI call failed for ${operation.id}: ${error instanceof Error ? `${error.name}: ${error.message}` : error}`);
      await this.reply(operation, message.userId, input.model, { content: text });
      throw new OperationAborted(text);
    }
    // Tokens and the answering model are recorded against what actually ran, so usage and admin stats stay true.
    const answeredBy = result.model.id;
    const usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, latencyMs: Date.now() - started, provider: result.provider, fellBack: result.fellBack };

    const parsed = copilotOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      const content = "I couldn't work out a safe change for that. Could you describe it differently?";
      await this.reply(operation, message.userId, answeredBy, { content, ...usage });
      return { kind: "reject", failures: [{ source: "copilot", message: "Plinth AI's answer wasn't a valid change." }] };
    }
    const output = parsed.data;

    if (output.refused) {
      await this.reply(operation, message.userId, answeredBy, { content: output.reply, refused: true, ...usage });
      return { kind: "noop", message: output.reply };
    }

    // Integrations are validated like the Integrations panel does, then queued as their own operations.
    const { followUps, notes } = await this.integrationFollowUps(output, installed.map((row) => row.integrationId));

    let files: { path: string; content: string }[] = [];
    try {
      const byPath = new Map(context.files.map((file) => [file.path, file.content]));
      files = applyEdits(output.edits, (path) => byPath.get(path) ?? null);
    } catch (error) {
      if (!(error instanceof CopilotEditError)) throw error;
      const content = `${output.reply}\n\nI couldn't apply that safely: ${error.message}`;
      await this.reply(operation, message.userId, answeredBy, { content, ...usage });
      return { kind: "reject", failures: [{ source: "copilot", file: error.path, message: error.message } satisfies OperationFailure] };
    }

    const changes: CopilotChanges = { files: files.map((file) => file.path), integrations: followUps.map((followUp) => followUp.summary) };
    await this.reply(operation, message.userId, answeredBy, { content: [output.reply, ...notes].join("\n\n"), changes, ...usage });

    if (output.title) {
      operation.summary = output.title.slice(0, 120);
      await this.prisma.operation.update({ where: { id: operation.id }, data: { summary: operation.summary } });
    }

    if (files.length === 0) return { kind: "noop", message: output.reply, followUps };
    return { kind: "change", files, tarball: null, onApplied: null, followUps };
  }

  private async integrationFollowUps(output: CopilotOutput, installed: string[]): Promise<{ followUps: FollowUp[]; notes: string[] }> {
    const followUps: FollowUp[] = [];
    const notes: string[] = [];
    for (const action of output.integrations) {
      let entry;
      try {
        entry = await this.catalogue.entry(action.integrationId);
      } catch {
        notes.push(`"${action.integrationId}" isn't available to install yet — you can request it from the Integrations panel.`);
        continue;
      }
      const { manifest } = entry;
      const isInstalled = installed.includes(manifest.id);
      if (action.action === "uninstall") {
        if (isInstalled) followUps.push({ type: "uninstall", input: { integrationId: manifest.id }, summary: `Remove ${manifest.name}` });
        continue;
      }
      const slot = action.slot ?? manifest.defaultSlot;
      if (!(manifest.allowedSlots as string[]).includes(slot)) {
        notes.push(`${manifest.name} can't go in that part of the page.`);
        continue;
      }
      if (action.action === "move") {
        if (isInstalled) followUps.push({ type: "move", input: { integrationId: manifest.id, slot }, summary: `Move ${manifest.name} to ${slot}` });
        continue;
      }
      if (isInstalled) continue;
      try {
        const props = this.catalogue.parseProps(manifest, action.props ?? {});
        const checked = await this.catalogue.validate(manifest.id, props);
        if (!checked.ok) {
          notes.push(`${manifest.name} wasn't added: ${Object.values(checked.fields).join(" ")}`);
          continue;
        }
        followUps.push({ type: "install", input: { integrationId: manifest.id, slot, props }, summary: `Install ${manifest.name}` });
      } catch {
        notes.push(`${manifest.name} needs a few details first — add it from the Integrations panel.`);
      }
    }
    return { followUps, notes };
  }

  private reply(
    operation: Operation,
    userId: string,
    model: string,
    data: { content: string; refused?: boolean; changes?: CopilotChanges; inputTokens?: number; outputTokens?: number; latencyMs?: number; provider?: string; fellBack?: boolean },
  ) {
    const message = { ...data, changes: data.changes as unknown as Prisma.InputJsonValue | undefined };
    return this.prisma.copilotMessage.create({
      data: { portfolioId: operation.portfolioId, userId, role: "assistant", model, operationId: operation.id, ...message },
    });
  }
}
