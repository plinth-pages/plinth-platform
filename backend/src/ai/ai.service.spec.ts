import { applyModelOverrides, buildModels } from "./ai-models";
import { AiProviderError, type AiProvider, type AiRequest, type AiResult } from "./ai-provider";
import { AiService, type RequestBuilder } from "./ai.service";

const OK: AiResult = { output: { refused: true, reply: "ok" }, text: "", usage: { inputTokens: 10, outputTokens: 5 }, stopReason: "tool_use" };

/** A provider whose answers are scripted per call; records every request it receives. */
function scripted(id: string, answers: (AiResult | AiProviderError)[], configured = true) {
  const calls: AiRequest[] = [];
  const provider: AiProvider = {
    id,
    configured: () => configured,
    generate: async (request) => {
      calls.push(request);
      const next = answers.shift() ?? new AiProviderError(id, "no more answers", false, "500");
      if (next instanceof AiProviderError) throw next;
      return next;
    },
  };
  return { provider, calls };
}

const config = (values: Record<string, string> = {}) => ({ get: (key: string) => values[key] }) as never;
const build: RequestBuilder = (_model, contextChars) => ({ system: `context ${contextChars}`, messages: [], tool: { name: "t", description: "", schema: {} }, temperature: 0 });

describe("AiService routing", () => {
  it("uses the first configured route and says nothing fell back", async () => {
    const groq = scripted("groq", [OK]);
    const result = await new AiService(config(), [groq.provider]).generate("free", build);
    expect(result).toMatchObject({ provider: "groq", fellBack: false, model: { id: "free" } });
    expect(groq.calls[0]).toMatchObject({ providerModel: "openai/gpt-oss-120b", maxTokens: 1_500, system: "context 11000" });
  });

  it("falls back from Groq to NVIDIA, sizing the request for the model that answers", async () => {
    const groq = scripted("groq", [new AiProviderError("groq", "Rate limit reached", true, "429")]);
    const nvidia = scripted("nvidia", [OK]);
    const result = await new AiService(config(), [groq.provider, nvidia.provider]).generate("free", build);
    expect(result).toMatchObject({ provider: "nvidia", fellBack: true, model: { id: "nvidia-llama-3.3-70b" } });
    expect(nvidia.calls[0]).toMatchObject({ providerModel: "meta/llama-3.3-70b-instruct", maxTokens: 4_000, system: "context 24000" });
  });

  it("reaches GPT-4o through OpenRouter when there's no OpenAI key, retrying within the credit it can afford", async () => {
    const openrouter = scripted("openrouter", [
      new AiProviderError("openrouter", "This request requires more credits, or fewer max_tokens. You requested up to 6000 tokens, but can only afford 4000.", false, "402"),
      OK,
    ]);
    const result = await new AiService(config(), [scripted("openai", [], false).provider, openrouter.provider]).generate("gpt-4o", build);
    expect(result).toMatchObject({ provider: "openrouter", fellBack: true, model: { id: "gpt-4o" } });
    expect(openrouter.calls.map((call) => [call.providerModel, call.maxTokens])).toEqual([
      ["openai/gpt-4o", 6_000],
      ["openai/gpt-4o", 3_950],
    ]);
  });

  it("halves the context once when a vendor says the request is too large", async () => {
    const groq = scripted("groq", [new AiProviderError("groq", "Request too large for model", false, "413"), OK]);
    await new AiService(config(), [groq.provider]).generate("free", build);
    expect(groq.calls.map((call) => call.system)).toEqual(["context 11000", "context 5500"]);
  });

  it("drops a Pro request to the free model when every Pro route fails, and reports the last real error when all fail", async () => {
    const anthropic = scripted("anthropic", [new AiProviderError("anthropic", "Overloaded", true, "529")]);
    const groq = scripted("groq", [OK]);
    const service = new AiService(config(), [anthropic.provider, groq.provider]);
    await expect(service.generate("claude-3-5-sonnet", build)).resolves.toMatchObject({ model: { id: "free" }, fellBack: true });

    const down = new AiService(config(), [scripted("groq", [new AiProviderError("groq", "Service unavailable", true, "503")]).provider]);
    await expect(down.generate("free", build)).rejects.toMatchObject({ provider: "groq", code: "503" });
    await expect(new AiService(config(), []).generate("free", build)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("offers a model when any of its routes is configured", () => {
    const service = new AiService(config(), [scripted("openrouter", []).provider]);
    expect(service.catalogue("pro").find((model) => model.id === "gpt-4o")).toMatchObject({ available: true, locked: false });
    expect(service.catalogue("pro").find((model) => model.id === "claude-3-5-sonnet")).toMatchObject({ available: false });
  });
});

describe("AI_MODELS overrides", () => {
  it("adds routes to an existing model and defines a new one", () => {
    const models = applyModelOverrides(
      buildModels(),
      JSON.stringify([
        { id: "claude-3-5-sonnet", alternates: [{ provider: "agentrouter", model: "claude-sonnet-4-5" }] },
        { id: "deepseek", label: "DeepSeek V3", tier: "pro", provider: "agentrouter", model: "deepseek-v3", maxOutputTokens: 3000 },
      ]),
    );
    expect(models.find((m) => m.id === "claude-3-5-sonnet")).toMatchObject({ provider: "anthropic", alternates: [{ provider: "agentrouter", providerModel: "claude-sonnet-4-5" }] });
    expect(models.find((m) => m.id === "deepseek")).toMatchObject({ badge: "Pro", tier: "pro", provider: "agentrouter", providerModel: "deepseek-v3", maxOutputTokens: 3000, fallbacks: ["free"] });
    expect(() => applyModelOverrides(buildModels(), JSON.stringify([{ id: "half-done", tier: "pro" }]))).toThrow(/needs label, tier, provider and model/);
  });

  it("is read from configuration", () => {
    const service = new AiService(config({ AI_MODELS: JSON.stringify([{ id: "gpt-4o", hidden: true }]) }), []);
    expect(service.catalogue("pro").map((model) => model.id)).not.toContain("gpt-4o");
  });
});
