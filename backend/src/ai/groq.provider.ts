import type Groq from "groq-sdk";
import { AiProviderError, type AiProvider, type AiRequest, type AiResult } from "./ai-provider";

/** The part of the SDK client this provider uses; tests pass a fake. */
export type GroqChat = Pick<Groq["chat"]["completions"], "create">;

/** Groq through the official SDK (OpenAI-compatible chat completions), with a forced function call for structured output. */
export class GroqProvider implements AiProvider {
  readonly id = "groq" as const;
  private chat: GroqChat | null;

  constructor(
    private readonly apiKey: string | undefined,
    chat?: GroqChat,
  ) {
    this.chat = chat ?? null;
  }

  configured(): boolean {
    return Boolean(this.chat || this.apiKey);
  }

  async generate(request: AiRequest): Promise<AiResult> {
    if (!this.configured()) throw new AiProviderError(this.id, "Groq isn't configured.", false, "NOT_CONFIGURED");
    if (!this.chat) {
      // Loaded lazily so the api role and tests never pay for the SDK.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { default: GroqClient } = require("groq-sdk") as typeof import("groq-sdk");
      this.chat = new GroqClient({ apiKey: this.apiKey, maxRetries: 3 }).chat.completions;
    }

    let response;
    try {
      response = await this.chat.create(
        {
          model: request.providerModel,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: false,
          messages: [{ role: "system", content: request.system }, ...request.messages.map((message) => ({ role: message.role, content: message.text }))],
          tools: [{ type: "function", function: { name: request.tool.name, description: request.tool.description, parameters: request.tool.schema } }],
          tool_choice: { type: "function", function: { name: request.tool.name } },
        },
        { signal: request.signal },
      );
    } catch (error) {
      const status = (error as { status?: number }).status;
      const message = (error as { error?: { error?: { message?: string } } }).error?.error?.message ?? (error as Error).message ?? String(error);
      throw new AiProviderError(this.id, message, status === 429 || (status ?? 500) >= 500, status ? String(status) : "NETWORK");
    }

    const choice = response.choices[0];
    const call = choice?.message.tool_calls?.find((toolCall) => toolCall.function.name === request.tool.name);
    let output: unknown = null;
    if (call) {
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
