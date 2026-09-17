/**
 * The seam every AI vendor plugs into. The co-pilot never talks to a vendor SDK directly: it asks for one structured
 * result (a tool call validated against a JSON schema) and gets back plain data plus token usage.
 */
/**
 * Built in: groq, anthropic, openai, bedrock, gemini, and the OpenAI-compatible openrouter, nvidia and agentrouter.
 * More OpenAI-compatible services can be added from configuration (AI_PROVIDERS), so the id is an open string.
 */
export type AiProviderId = string;

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

/** The vendor said the request was over its size limit for a single call. */
export function tooLarge(error: unknown): boolean {
  return error instanceof AiProviderError && (error.code === "413" || /too large|context length|maximum context|reduce your message/i.test(error.message));
}

/**
 * A pay-as-you-go account (OpenRouter, for example) can refuse a request because the reply it *might* produce costs
 * more than the remaining credit, and says how much it can afford. Below a useful size, retrying isn't worth it.
 */
export function affordableTokens(error: unknown): number | null {
  if (!(error instanceof AiProviderError) || (error.code !== "402" && !/afford|credits/i.test(error.message))) return null;
  const match = /can only afford (\d+)/i.exec(error.message);
  const tokens = match ? Number(match[1]) - 50 : 0;
  return tokens >= 800 ? tokens : null;
}
