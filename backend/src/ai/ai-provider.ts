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

  /** Every route tried before this failure, in order. Set by the service; the alert reports it. */
  attempts: string[] = [];
}

/** The vendor said the request was over its size limit for a single call. */
/**
 * What to tell someone when a request could not be answered.
 *
 * Almost none of these are Plinth being broken: the model service is busy, out of capacity, or not serving that
 * model today. Saying "Plinth AI isn't available" for all of them reads as our software failing, leaves people
 * wondering whether their site was damaged, and gives them nothing to do about it. Each case says what happened,
 * that the site is untouched, and what to try instead.
 *
 * Never names a provider or a key: which company answers a request is not the user's business, and saying so in an
 * error is how infrastructure leaks into a product.
 */
export function explainAiFailure(error: unknown): string {
  const code = error instanceof AiProviderError ? (error.code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);
  const nothingChanged = "Your site is unchanged.";

  if (code === "NOT_CONFIGURED") {
    return `That model isn't switched on yet. Pick a different one below and your change will go through. ${nothingChanged}`;
  }
  if (code === "429" || /rate.?limit|too many requests|slow down/i.test(message)) {
    return `Plinth AI is in heavy demand right now, so the model asked us to slow down. Give it a minute and send it again — ${nothingChanged.toLowerCase()}`;
  }
  if (tooLarge(error)) {
    return `That request needs more room than this model allows. Ask for one change at a time, or pick a larger model below. ${nothingChanged}`;
  }
  if (code === "402" || code === "403" || /afford|credit|quota|billing|overdue|insufficient/i.test(message)) {
    return `Plinth AI has used up its allowance with the model service for now. This is on us, not on anything you did. Try again a little later, or pick another model below. ${nothingChanged}`;
  }
  if (retiredModel(error)) {
    return `That model has been retired by the people who host it. Pick a different one below — we're already on it. ${nothingChanged}`;
  }
  if (code === "503" || code === "404" || /no available channel|not available|无可用渠道|does not exist/i.test(message)) {
    return `That model isn't being served at the moment. Pick a different one below and try again. ${nothingChanged}`;
  }
  if (code === "401") {
    return `Plinth AI couldn't get in to the model service. That's our problem, not yours, and we've been told about it. Try another model below in the meantime. ${nothingChanged}`;
  }
  if (noToolCall(error)) {
    return `Plinth AI answered in words when it needed to make a change. Say it again in one sentence — or pick another model below, which usually settles it. ${nothingChanged}`;
  }
  if (code === "NETWORK" || /timeout|timed out|aborted|ECONN|socket/i.test(message)) {
    return `The model took too long to answer and we stopped waiting. Send it again — ${nothingChanged.toLowerCase()}`;
  }
  if (/^5\d\d$/.test(code)) {
    return `The model service is having trouble at its end. It usually passes in a few minutes; send it again then. ${nothingChanged}`;
  }
  return `Plinth AI couldn't answer that one. Sending it again often works, and picking another model below almost always does. ${nothingChanged}`;
}
/**
 * The model ran out of room mid-answer, so its tool call is cut off and won't parse. Providers report this as a 400
 * about the arguments rather than as a length error, which made it look like a broken request instead of one asking
 * for more than the reply budget could hold. Asking for less is the fix, not giving up.
 */
export function truncatedAnswer(error: unknown): boolean {
  return (
    error instanceof AiProviderError &&
    /failed to parse tool call|tool call arguments|unterminated string|unexpected end of (json|input)/i.test(error.message)
  );
}

export function tooLarge(error: unknown): boolean {
  return (
    error instanceof AiProviderError &&
    // A prompt over the account's ceiling arrives as a 402 mentioning credits, which reads like running out of money
    // and is really running out of room. Classed by what it is, so the retry shrinks the request instead of giving up.
    (error.code === "413" || /too large|context length|maximum context|reduce your message|prompt tokens limit exceeded|prompt is too long/i.test(error.message))
  );
}

/**
 * The prompt ceiling a service just named, in characters. "Prompt tokens limit exceeded: 11207 > 7412" says exactly
 * how much room there is, so the retry can be sized to fit rather than halved and halved again until it lands.
 */
export function promptCeilingChars(error: unknown): number | null {
  if (!(error instanceof AiProviderError)) return null;
  const match = /limit exceeded:\s*\d+\s*>\s*(\d+)/i.exec(error.message);
  if (!match) return null;
  const tokens = Number(match[1]);
  if (!Number.isFinite(tokens) || tokens < 500) return null;
  // Three characters per token is deliberately pessimistic, and the system prompt and tool schema take their share.
  return Math.max(1_000, Math.floor(tokens * 3 * 0.7));
}

/**
 * The model answered in prose when it was required to call the tool. Nothing is wrong with the request or with us —
 * the model simply didn't follow the contract that turns an answer into a change.
 */
/**
 * The model has been retired by whoever hosts it. Nothing will fix this but pointing at a different model, so it is
 * worth telling a person about rather than logging and falling through for weeks.
 */
export function retiredModel(error: unknown): boolean {
  return error instanceof AiProviderError && (error.code === "410" || /end of life|no longer available|has been (retired|deprecated)|decommissioned/i.test(error.message));
}

export function noToolCall(error: unknown): boolean {
  return error instanceof AiProviderError && /did not call a tool|tool choice is required|no tool call/i.test(error.message);
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
