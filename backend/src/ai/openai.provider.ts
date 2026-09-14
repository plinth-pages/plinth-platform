import type OpenAI from "openai";
import { AiProviderError, type AiProvider, type AiRequest, type AiResult } from "./ai-provider";

/** The part of the SDK client this provider uses; tests pass a fake. */
export type OpenAIChat = Pick<OpenAI["chat"]["completions"], "create">;

/** OpenAI through the official SDK, with a forced function call for structured output. */
export class OpenAIProvider implements AiProvider {
  readonly id = "openai" as const;
  private chat: OpenAIChat | null;

  constructor(
    private readonly apiKey: string | undefined,
    chat?: OpenAIChat,
  ) {
    this.chat = chat ?? null;
  }

  configured(): boolean {
    return Boolean(this.chat || this.apiKey);
  }

  async generate(request: AiRequest): Promise<AiResult> {
    if (!this.configured()) throw new AiProviderError(this.id, "OpenAI isn't configured.", false, "NOT_CONFIGURED");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require("openai") as typeof import("openai");
    this.chat ??= new sdk.default({ apiKey: this.apiKey, maxRetries: 2 }).chat.completions;

    let response;
    try {
      response = await this.chat.create(
        {
          model: request.providerModel,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          messages: [{ role: "system", content: request.system }, ...request.messages.map((message) => ({ role: message.role, content: message.text }))],
          tools: [{ type: "function", function: { name: request.tool.name, description: request.tool.description, parameters: request.tool.schema } }],
          tool_choice: { type: "function", function: { name: request.tool.name } },
        },
        { signal: request.signal },
      );
    } catch (error) {
      const status = (error as { status?: number }).status;
      throw new AiProviderError(this.id, (error as Error).message ?? String(error), status === 429 || status === undefined || status >= 500, status ? String(status) : "NETWORK");
    }

    const choice = response.choices[0];
    const call = choice?.message.tool_calls?.find((toolCall) => toolCall.type === "function" && toolCall.function.name === request.tool.name);
    let output: unknown = null;
    if (call && call.type === "function") {
      try {
        output = JSON.parse(call.function.arguments);
      } catch {
        output = null;
      }
    }
    return {
      output,
      text: choice?.message.content ?? "",
      usage: { inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 },
      stopReason: choice?.finish_reason ?? null,
    };
  }
}
