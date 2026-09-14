import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CopilotModelSummary } from "@plinth-pages/shared";
import type { Env } from "../config/env";
import { buildModels, DEFAULT_MODEL_ID, type ModelDefinition } from "./ai-models";
import { AiProviderError, type AiProvider, type AiProviderId, type AiRequest, type AiResult } from "./ai-provider";
import { AnthropicProvider } from "./anthropic.provider";
import { BedrockProvider } from "./bedrock.provider";
import { GeminiProvider } from "./gemini.provider";
import { GroqProvider } from "./groq.provider";
import { OpenAIProvider } from "./openai.provider";

export { buildModels, DEFAULT_GROQ_MODEL, DEFAULT_MODEL_ID, type ModelDefinition } from "./ai-models";

/** Lets tests swap vendors for a scripted provider. */
export const AI_PROVIDERS = Symbol("AI_PROVIDERS");

/** One line per vendor. A provider without credentials reports `configured() === false` and its models are unavailable. */
export function createProviders(config: ConfigService<Env, true>): AiProvider[] {
  return [
    new GroqProvider(config.get("GROQ_API_KEY", { infer: true })),
    new AnthropicProvider(config.get("ANTHROPIC_API_KEY", { infer: true })),
    new OpenAIProvider(config.get("OPENAI_API_KEY", { infer: true })),
    new BedrockProvider({
      region: config.get("AWS_REGION", { infer: true }),
      accessKeyId: config.get("AWS_ACCESS_KEY_ID", { infer: true }),
      secretAccessKey: config.get("AWS_SECRET_ACCESS_KEY", { infer: true }),
    }),
    new GeminiProvider(config.get("GEMINI_API_KEY", { infer: true })),
  ];
}

@Injectable()
export class AiService {
  private readonly providers: Map<AiProviderId, AiProvider>;
  readonly models: ModelDefinition[];

  constructor(config: ConfigService<Env, true>, @Optional() @Inject(AI_PROVIDERS) providers?: AiProvider[]) {
    this.providers = new Map((providers ?? createProviders(config)).map((provider) => [provider.id, provider]));
    this.models = buildModels({ groqModel: config.get("GROQ_MODEL", { infer: true }) });
  }

  findModel(id: string): ModelDefinition | undefined {
    return this.models.find((model) => model.id === id);
  }

  /** What the model selector shows for a plan: Pro models are locked on Free, and unavailable until their vendor is configured. */
  catalogue(plan: "free" | "pro" = "free"): CopilotModelSummary[] {
    return this.models
      .filter((model) => !model.hidden)
      .map((model) => ({
        id: model.id,
        label: model.label,
        badge: model.badge,
        tier: model.tier,
        locked: model.tier === "pro" && plan !== "pro",
        available: (model.tier === "free" || plan === "pro") && Boolean(this.providers.get(model.provider)?.configured()),
        default: model.id === DEFAULT_MODEL_ID,
      }));
  }

  async generate(modelId: string, request: Omit<AiRequest, "providerModel">): Promise<AiResult & { model: ModelDefinition }> {
    const model = this.findModel(modelId);
    if (!model) throw new AiProviderError("groq", `Unknown model ${modelId}`, false, "UNKNOWN_MODEL");
    const provider = this.providers.get(model.provider);
    if (!provider?.configured()) throw new AiProviderError(model.provider, `${model.label} isn't available right now.`, false, "NOT_CONFIGURED");
    const result = await provider.generate({ ...request, providerModel: model.providerModel });
    return { ...result, model };
  }
}
