/**
 * The seam every AI vendor plugs into. The co-pilot never talks to a vendor SDK directly: it asks for one structured
 * result (a tool call validated against a JSON schema) and gets back plain data plus token usage.
 */
export type AiProviderId = "groq" | "bedrock" | "gemini" | "openai";

export interface AiMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AiTool {
  name: string;
  description: string;
  /** JSON Schema (draft-07 subset) for the tool's input. */
  schema: Record<string, unknown>;
}

export interface AiRequest {
  /** The vendor's model identifier, e.g. `anthropic.claude-3-haiku-20240307-v1:0`. */
  providerModel: string;
  system: string;
  messages: AiMessage[];
  /** The model must answer by calling this tool, exactly once. */
  tool: AiTool;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiResult {
  /** The tool input the model produced; validate before use. `null` when the model didn't call the tool. */
  output: unknown;
  /** Any plain text the model produced alongside (or instead of) the tool call. */
  text: string;
  usage: AiUsage;
  stopReason: string | null;
}

export interface AiProvider {
  readonly id: AiProviderId;
  /** Whether credentials are present. A configured provider can still be refused by the vendor at call time. */
  configured(): boolean;
  generate(request: AiRequest): Promise<AiResult>;
}

/** A vendor refused or failed the call. `retryable` is true for throttling and transient server errors. */
export class AiProviderError extends Error {
  constructor(
    readonly provider: AiProviderId,
    message: string,
    readonly retryable: boolean,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
