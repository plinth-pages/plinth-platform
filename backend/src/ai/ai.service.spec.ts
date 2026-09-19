import { DEFAULT_NVIDIA_MODEL, applyModelOverrides, buildModels } from "./ai-models";
import { AiProviderError, explainAiFailure, noToolCall, promptCeilingChars, retiredModel, tooLarge, truncatedAnswer, type AiProvider, type AiRequest, type AiResult } from "./ai-provider";
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
    expect(nvidia.calls[0]).toMatchObject({ providerModel: DEFAULT_NVIDIA_MODEL, maxTokens: 4_000, system: "context 24000" });
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

  it("keeps Pro working on the shared pool alone, when no direct vendor key is set", async () => {
    const service = new AiService(config(), [scripted("agentrouter", [OK, OK]).provider]);
    for (const id of ["claude-opus-5", "deepseek-v4"]) {
      expect(service.catalogue("pro").find((model) => model.id === id)).toMatchObject({ available: true, locked: false });
    }
    // Opus is the same model whichever route serves it, so the shared pool answers under its own id.
    await expect(service.generate("claude-opus-5", build)).resolves.toMatchObject({ model: { id: "claude-opus-5" }, provider: "agentrouter" });
    // Sonnet has no shared-pool route, so it reaches Opus as a fallback — and is recorded as Opus, not as itself.
    await expect(service.generate("claude-3-5-sonnet", build)).resolves.toMatchObject({ model: { id: "claude-opus-5" }, fellBack: true });
  });

  it("follows fallbacks all the way down, so a Pro request reaches the larger free model", async () => {
    // What happened in production: Opus had no working route, the chain stopped at the smallest free model, and
    // the free model's own fallback - bigger context, bigger reply - was never tried.
    const fail = new AiProviderError("groq", "Failed to parse tool call arguments as JSON", false, "400");
    const groq = scripted("groq", [fail, fail]);
    const nvidia = scripted("nvidia", [OK]);
    const service = new AiService(config(), [groq.provider, nvidia.provider]);
    await expect(service.generate("claude-opus-5", build)).resolves.toMatchObject({ model: { id: "nvidia-llama-3.3-70b" }, fellBack: true });
  });

  it("reports every route it tried, not just the last one", async () => {
    // Twice: a cut-off answer is retried with less context before the route is given up on.
    const cut = () => new AiProviderError("groq", "Failed to parse tool call arguments as JSON", false, "400");
    const groq = scripted("groq", [cut(), cut()]);
    const service = new AiService(config(), [groq.provider]);
    const error = await service.generate("claude-opus-5", build).catch((e) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    // The question an alert has to answer is why the model the user picked did not answer.
    expect(error.attempts.join(" ")).toContain("claude-opus-5 via anthropic: no key");
    expect(error.attempts.join(" ")).toContain("claude-opus-5 via agentrouter: no key");
    expect(error.attempts.some((a: string) => a.includes("free via groq") && a.includes("400"))).toBe(true);
  });

  it("asks for less when a reply was cut off mid-answer, instead of failing the request", async () => {
    const cut = new AiProviderError("groq", "Failed to parse tool call arguments as JSON", false, "400");
    expect(truncatedAnswer(cut)).toBe(true);
    expect(tooLarge(cut)).toBe(false);

    const groq = scripted("groq", [cut, OK]);
    const service = new AiService(config(), [groq.provider]);
    await expect(service.generate("free", build)).resolves.toMatchObject({ model: { id: "free" } });
    // The second attempt was made with less of the site, so the model writes a change small enough to finish.
    const chars = groq.calls.map((call) => Number(call.system.replace("context ", "")));
    expect(chars).toHaveLength(2);
    expect(chars[1]).toBeLessThan(chars[0]);
  });
  it("tries again when the model answered in prose, instead of dropping to a weaker one", async () => {
    const prose = new AiProviderError("groq", "Tool choice is required, but model did not call a tool", false, "400");
    const groq = scripted("groq", [prose, OK]);
    const nvidia = scripted("nvidia", [OK]);
    const service = new AiService(config(), [groq.provider, nvidia.provider]);
    // Answered by the model that was asked for, on its second go - not by the fallback.
    await expect(service.generate("free", build)).resolves.toMatchObject({ model: { id: "free" }, fellBack: false });
    expect(groq.calls).toHaveLength(2);
    expect(nvidia.calls).toHaveLength(0);
  });

  it("treats a retired model as permanent, and says so", () => {
    const gone = new AiProviderError("nvidia", "410 The model meta/llama-3.3-70b-instruct has reached its end of life on 2026-08-26T09:00:00Z and is no longer available.", false, "410");
    expect(retiredModel(gone)).toBe(true);
    expect(explainAiFailure(gone)).toMatch(/has been retired/i);
    // Not mistaken for a passing outage, which would tell someone to wait it out forever.
    expect(explainAiFailure(gone)).not.toMatch(/few minutes|heavy demand/i);
  });

  it("keeps the NVIDIA model configurable, because hosted models get retired", () => {
    const moved = buildModels({ nvidiaModel: "meta/llama-4-maverick-17b-128e-instruct" });
    expect(moved.find((m) => m.id === "nvidia-llama-3.3-70b")).toMatchObject({ providerModel: "meta/llama-4-maverick-17b-128e-instruct" });
    // The id never moves: it is stored against every message that model answered.
    expect(buildModels().find((m) => m.id === "nvidia-llama-3.3-70b")?.providerModel).toBe(DEFAULT_NVIDIA_MODEL);
  });
  it("never lets one model answer under another's name", () => {
    for (const model of buildModels()) {
      for (const route of model.alternates ?? []) {
        // An alternate is the same model somewhere else. A different model belongs in fallbacks, where the reply is
        // recorded against the model that actually wrote it.
        expect(route.providerModel).toContain(model.providerModel.split("/").pop()!.replace(/-latest$/, ""));
      }
    }
  });
});

describe("explaining a failure to the person who asked", () => {
  const say = (code: string, message = "boom") => explainAiFailure(new AiProviderError("groq", message, false, code));

  it("blames the model service, not Plinth, and never names a provider", () => {
    const all = ["NOT_CONFIGURED", "429", "402", "403", "503", "401", "NETWORK", "500", "418"].map((c) => say(c));
    for (const text of all) {
      expect(text).not.toMatch(/groq|openai|anthropic|agentrouter|nvidia|bedrock|gemini|openrouter/i);
      // Everyone needs to know their work survived.
      expect(text.toLowerCase()).toContain("site is unchanged");
      expect(text.length).toBeLessThan(260);
    }
  });

  it("tells demand, allowance and outage apart instead of saying the same thing", () => {
    expect(say("429")).toMatch(/heavy demand/i);
    expect(say("402")).toMatch(/used up its allowance/i);
    expect(say("403", "Access denied due to overdue account")).toMatch(/used up its allowance/i);
    expect(say("503")).toMatch(/isn.t being served/i);
    expect(say("500")).toMatch(/trouble at its end/i);
    expect(say("NETWORK")).toMatch(/took too long/i);
    expect(say("NOT_CONFIGURED")).toMatch(/isn.t switched on/i);
    // Distinct messages, not one sentence wearing different hats.
    const texts = ["429", "402", "503", "500", "NETWORK", "NOT_CONFIGURED", "401"].map((c) => say(c));
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("reads the reason out of the message when there is no useful status", () => {
    expect(explainAiFailure(new AiProviderError("groq", "Rate limit reached for model", false, null))).toMatch(/heavy demand/i);
    expect(explainAiFailure(new AiProviderError("groq", "You have insufficient credits", false, null))).toMatch(/used up its allowance/i);
    expect(explainAiFailure(new Error("socket hang up"))).toMatch(/took too long/i);
  });

  it("still says something useful for a failure it has never seen", () => {
    expect(say("418", "I am a teapot")).toMatch(/couldn.t answer that one/i);
  });
});
describe("failures seen in production", () => {
  const or402 = new AiProviderError(
    "openrouter",
    "402 Prompt tokens limit exceeded: 11207 > 7412. To increase, visit https://openrouter.ai/settings/credits and upgrade to a paid account",
    false,
    "402",
  );

  it("reads a prompt ceiling as too big, not as out of money", () => {
    // It arrives as a 402 mentioning credits, but the account has room - the request does not.
    expect(tooLarge(or402)).toBe(true);
    expect(promptCeilingChars(or402)).toBeGreaterThan(1_000);
    expect(promptCeilingChars(or402)).toBeLessThan(7_412 * 4);
    expect(explainAiFailure(or402)).toMatch(/needs more room/i);
    expect(explainAiFailure(or402)).not.toMatch(/allowance/i);
  });

  it("retries inside the ceiling the service named, not at half a budget that is still too big", async () => {
    const openrouter = scripted("openrouter", [or402, OK]);
    const service = new AiService(config(), [openrouter.provider]);
    await expect(service.generate("gpt-4o", build)).resolves.toMatchObject({ model: { id: "gpt-4o" } });
    const chars = openrouter.calls.map((call) => Number(call.system.replace("context ", "")));
    expect(chars[0]).toBe(120_000);
    // Half of 120k would still be four times over the stated limit.
    expect(chars[1]).toBeLessThan(7_412 * 4);
  });

  it("explains a model that answered in prose instead of making a change", () => {
    const prose = new AiProviderError("groq", "Tool choice is required, but model did not call a tool", false, "400");
    expect(noToolCall(prose)).toBe(true);
    expect(explainAiFailure(prose)).toMatch(/answered in words/i);
  });

  it("explains a model the account cannot be served", () => {
    const noChannel = new AiProviderError("agentrouter", "503 当前分组 default 下对于模型 claude-3-5-sonnet 无可用渠道", false, "503");
    expect(explainAiFailure(noChannel)).toMatch(/isn.t being served/i);
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
