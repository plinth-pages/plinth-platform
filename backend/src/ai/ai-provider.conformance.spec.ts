import Anthropic from "@anthropic-ai/sdk";
import { AiProviderError, type AiProvider, type AiRequest } from "./ai-provider";
import { AnthropicProvider, type AnthropicMessages } from "./anthropic.provider";
import { BedrockProvider } from "./bedrock.provider";
import { GeminiProvider } from "./gemini.provider";
import { GroqProvider, type GroqChat } from "./groq.provider";
import { OpenAIProvider, type OpenAIChat } from "./openai.provider";

/**
 * The contract every AI provider must honour, run against each vendor with its SDK faked. A new provider is added to
 * PROVIDERS below; if it passes, the co-pilot can use it without any other change.
 */
type Scenario = "tool" | "no-tool" | "rate-limited" | "rejected";

interface ProviderUnderTest {
  name: string;
  /** A provider whose vendor answers the given way, or `null` to build one without credentials. */
  build(scenario: Scenario | null): AiProvider;
}

const ANSWER = { refused: true, reply: "I can only help edit this portfolio.", title: "", edits: [], integrations: [] };
const USAGE = { input: 120, output: 30 };

const PROVIDERS: ProviderUnderTest[] = [
  {
    name: "groq",
    build: (scenario) => {
      if (!scenario) return new GroqProvider(undefined);
      const chat = {
        create: async () => {
          if (scenario === "rate-limited") throw Object.assign(new Error("Rate limit reached"), { status: 429 });
          if (scenario === "rejected") throw Object.assign(new Error("Invalid API key"), { status: 401 });
          const toolCalls = scenario === "tool" ? [{ id: "1", type: "function", function: { name: "submit_changes", arguments: JSON.stringify(ANSWER) } }] : undefined;
          return { choices: [{ finish_reason: "stop", message: { content: "plain text", tool_calls: toolCalls } }], usage: { prompt_tokens: USAGE.input, completion_tokens: USAGE.output } };
        },
      } as unknown as GroqChat;
      return new GroqProvider(undefined, chat);
    },
  },
  {
    name: "openai",
    build: (scenario) => {
      if (!scenario) return new OpenAIProvider(undefined);
      const chat = {
        create: async () => {
          if (scenario === "rate-limited") throw Object.assign(new Error("Rate limit reached"), { status: 429 });
          if (scenario === "rejected") throw Object.assign(new Error("Incorrect API key"), { status: 401 });
          const toolCalls = scenario === "tool" ? [{ id: "1", type: "function", function: { name: "submit_changes", arguments: JSON.stringify(ANSWER) } }] : undefined;
          return { choices: [{ finish_reason: "stop", message: { content: "plain text", tool_calls: toolCalls } }], usage: { prompt_tokens: USAGE.input, completion_tokens: USAGE.output } };
        },
      } as unknown as OpenAIChat;
      return new OpenAIProvider(undefined, chat);
    },
  },
  {
    name: "anthropic",
    build: (scenario) => {
      if (!scenario) return new AnthropicProvider(undefined);
      const messages = {
        create: async () => {
          if (scenario === "rate-limited") throw new Anthropic.RateLimitError(429, undefined, "Rate limited", new Headers());
          if (scenario === "rejected") throw new Anthropic.AuthenticationError(401, undefined, "Invalid API key", new Headers());
          const content = scenario === "tool" ? [{ type: "tool_use", id: "t1", name: "submit_changes", input: ANSWER }] : [{ type: "text", text: "plain text" }];
          return { content, stop_reason: scenario === "tool" ? "tool_use" : "end_turn", usage: { input_tokens: USAGE.input, output_tokens: USAGE.output } };
        },
      } as unknown as AnthropicMessages;
      return new AnthropicProvider(undefined, messages);
    },
  },
  {
    name: "bedrock",
    build: (scenario) => {
      if (!scenario) return new BedrockProvider({});
      return new BedrockProvider(
        {},
        {
          send: async () => {
            if (scenario === "rate-limited") throw Object.assign(new Error("Too many requests"), { name: "ThrottlingException" });
            if (scenario === "rejected") throw Object.assign(new Error("Access denied"), { name: "AccessDeniedException" });
            const content = scenario === "tool" ? [{ toolUse: { toolUseId: "1", name: "submit_changes", input: ANSWER } }] : [{ text: "plain text" }];
            return { output: { message: { role: "assistant", content } }, usage: { inputTokens: USAGE.input, outputTokens: USAGE.output, totalTokens: 150 }, stopReason: "end_turn", metrics: { latencyMs: 1 }, $metadata: {} } as never;
          },
        },
      );
    },
  },
  {
    name: "gemini",
    build: (scenario) => {
      if (!scenario) return new GeminiProvider(undefined);
      const fake = (async () => {
        if (scenario === "rate-limited") return new Response(JSON.stringify({ error: { message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } }), { status: 429 });
        if (scenario === "rejected") return new Response(JSON.stringify({ error: { message: "API key not valid", status: "PERMISSION_DENIED" } }), { status: 403 });
        const parts = scenario === "tool" ? [{ functionCall: { name: "submit_changes", args: ANSWER } }] : [{ text: "plain text" }];
        return new Response(JSON.stringify({ candidates: [{ content: { parts }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: USAGE.input, candidatesTokenCount: USAGE.output } }), { status: 200 });
      }) as unknown as typeof fetch;
      return new GeminiProvider("key", fake);
    },
  },
];

const request: AiRequest = {
  providerModel: "model",
  system: "system prompt",
  messages: [{ role: "user", text: "hello" }],
  tool: { name: "submit_changes", description: "Submit", schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] } },
  maxTokens: 500,
  temperature: 0,
};

describe.each(PROVIDERS)("AI provider contract: $name", ({ name, build }) => {
  it("returns the tool call's input as data, with token usage", async () => {
    const result = await build("tool").generate(request);
    expect(result.output).toEqual(ANSWER);
    expect(result.usage).toEqual({ inputTokens: USAGE.input, outputTokens: USAGE.output });
  });

  it("returns null output when the model answers without the tool, so nothing is applied", async () => {
    const result = await build("no-tool").generate(request);
    expect(result.output).toBeNull();
    expect(result.text).toContain("plain text");
  });

  it("marks rate limits as retryable", async () => {
    await expect(build("rate-limited").generate(request)).rejects.toMatchObject({ name: "AiProviderError", provider: name, retryable: true });
  });

  it("marks credential and request errors as not retryable", async () => {
    const error = await build("rejected").generate(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({ provider: name, retryable: false });
  });

  it("reports itself unconfigured without credentials, and refuses to call the vendor", async () => {
    const provider = build(null);
    expect(provider.configured()).toBe(false);
    await expect(provider.generate(request)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});
