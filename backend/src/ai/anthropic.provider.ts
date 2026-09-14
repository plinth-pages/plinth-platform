import type Anthropic from "@anthropic-ai/sdk";
import { AiProviderError, type AiProvider, type AiRequest, type AiResult } from "./ai-provider";

/** The part of the SDK client this provider uses; tests pass a fake. */
export type AnthropicMessages = Pick<Anthropic["messages"], "create">;

/**
 * Claude through the Anthropic API (official SDK).
 *
 * The tool is offered with `tool_choice: auto` rather than forced: forced tool choice is rejected by some current
 * Claude models, while the system prompt already requires answering only through the tool. An answer without the
 * tool call comes back as `output: null`, which the co-pilot treats as "no valid change" — never applied.
 */
export class AnthropicProvider implements AiProvider {
  readonly id = "anthropic" as const;
  private messages: AnthropicMessages | null;

  constructor(
    private readonly apiKey: string | undefined,
    messages?: AnthropicMessages,
  ) {
    this.messages = messages ?? null;
  }

  configured(): boolean {
    return Boolean(this.messages || this.apiKey);
  }

  async generate(request: AiRequest): Promise<AiResult> {
    if (!this.configured()) throw new AiProviderError(this.id, "Anthropic isn't configured.", false, "NOT_CONFIGURED");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require("@anthropic-ai/sdk") as typeof import("@anthropic-ai/sdk");
    this.messages ??= new sdk.default({ apiKey: this.apiKey, maxRetries: 2 }).messages;

    let response: Anthropic.Message;
    try {
      response = await this.messages.create(
        {
          model: request.providerModel,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: request.messages.map((message) => ({ role: message.role, content: message.text })),
          tools: [{ name: request.tool.name, description: request.tool.description, input_schema: request.tool.schema as Anthropic.Tool.InputSchema }],
          tool_choice: { type: "auto" },
        },
        { signal: request.signal },
      );
    } catch (error) {
      if (error instanceof sdk.RateLimitError) throw new AiProviderError(this.id, error.message, true, "429");
      if (error instanceof sdk.InternalServerError) throw new AiProviderError(this.id, error.message, true, String(error.status));
      if (error instanceof sdk.APIConnectionError) throw new AiProviderError(this.id, error.message, true, "NETWORK");
      if (error instanceof sdk.APIError) throw new AiProviderError(this.id, error.message, (error.status ?? 0) >= 500, String(error.status));
      throw new AiProviderError(this.id, (error as Error).message ?? String(error), false);
    }

    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === request.tool.name);
    return {
      output: toolUse?.input ?? null,
      text: response.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      stopReason: response.stop_reason ?? null,
    };
  }
}
