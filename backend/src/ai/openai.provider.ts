import type OpenAI from "openai";
import { AiProviderError, type AiProvider, type AiRequest, type AiResult } from "./ai-provider";

/** The part of the SDK client this provider uses; tests pass a fake. */
export type OpenAIChat = Pick<OpenAI["chat"]["completions"], "create">;

export interface OpenAICompatibleOptions {
  /** Provider id used in model routes, e.g. "openrouter". Defaults to "openai". */
  id?: string;
  /** Human name for errors and logs. */
  name?: string;
  /** API root, e.g. https://openrouter.ai/api/v1. Unset means the SDK's default (OpenAI, or OPENAI_BASE_URL). */
  baseURL?: string;
  /** Extra headers some services ask for (OpenRouter's app attribution, for example). */
  headers?: Record<string, string>;
}

/**
 * OpenAI — and any OpenAI-compatible service (OpenRouter, NVIDIA, AgentRouter…) — through the official SDK, with a
 * forced function call for structured output.
 */
export class OpenAIProvider implements AiProvider {
  readonly id: string;
  private readonly name: string;
  private chat: OpenAIChat | null;

  constructor(
    private readonly apiKey: string | undefined,
    chat?: OpenAIChat,
    private readonly options: OpenAICompatibleOptions = {},
  ) {
    this.chat = chat ?? null;
    this.id = options.id ?? "openai";
    this.name = options.name ?? "OpenAI";
  }

  configured(): boolean {
    return Boolean(this.chat || this.apiKey);
  }

  async generate(request: AiRequest): Promise<AiResult> {
    if (!this.configured()) throw new AiProviderError(this.id, `${this.name} isn't configured.`, false, "NOT_CONFIGURED");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require("openai") as typeof import("openai");
    this.chat ??= new sdk.default({
      apiKey: this.apiKey,
      maxRetries: 1,
      ...(this.options.baseURL ? { baseURL: this.options.baseURL } : {}),
      ...(this.options.headers ? { defaultHeaders: this.options.headers } : {}),
    }).chat.completions;

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
