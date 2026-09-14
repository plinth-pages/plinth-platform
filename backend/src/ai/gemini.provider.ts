import { AiProviderError, type AiProvider, type AiRequest, type AiResult } from "./ai-provider";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Google Gemini through the REST API, with a forced function call for structured output. */
export class GeminiProvider implements AiProvider {
  readonly id = "gemini" as const;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  configured(): boolean {
    return Boolean(this.apiKey);
  }

  async generate(request: AiRequest): Promise<AiResult> {
    if (!this.apiKey) throw new AiProviderError(this.id, "Gemini isn't configured.", false, "NOT_CONFIGURED");
    const response = await this.fetchImpl(`${ENDPOINT}/${encodeURIComponent(request.providerModel)}:generateContent`, {
      method: "POST",
      // The key travels in a header, never in the URL, so it can't end up in access logs.
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      signal: request.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: request.messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.text }] })),
        tools: [{ functionDeclarations: [{ name: request.tool.name, description: request.tool.description, parameters: request.tool.schema }] }],
        toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [request.tool.name] } },
        generationConfig: { maxOutputTokens: request.maxTokens, temperature: request.temperature },
      }),
    }).catch((error: Error) => {
      throw new AiProviderError(this.id, error.message, true, "NETWORK");
    });

    const json = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; status?: string };
      candidates?: { content?: { parts?: { text?: string; functionCall?: { name: string; args: unknown } }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    if (!response.ok) {
      throw new AiProviderError(this.id, json.error?.message ?? `Gemini returned ${response.status}`, response.status === 429 || response.status >= 500, json.error?.status ?? String(response.status));
    }
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    return {
      output: parts.find((part) => part.functionCall?.name === request.tool.name)?.functionCall?.args ?? null,
      text: parts.map((part) => part.text ?? "").join(""),
      usage: { inputTokens: json.usageMetadata?.promptTokenCount ?? 0, outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0 },
      stopReason: json.candidates?.[0]?.finishReason ?? null,
    };
  }
}
