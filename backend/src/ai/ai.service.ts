import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CopilotModelSummary } from "@plinth-pages/shared";
import type { Env } from "../config/env";
import { AiProviderError, type AiProvider, type AiProviderId, type AiRequest, type AiResult } from "./ai-provider";
import { BedrockProvider } from "./bedrock.provider";
import { GeminiProvider } from "./gemini.provider";

export interface ModelDefinition {
  id: string;
  label: string;
  badge: string;
  provider: AiProviderId;
  providerModel: string;
  /** `pro` models need a paid plan (Phase 14). */
  tier: "free" | "pro";
  /** Hidden models can be enabled by configuration but aren't offered in the selector. */
  hidden?: boolean;
}

/** Every model the co-pilot knows about. Adding a vendor is a provider class plus entries here. */
export const MODELS: ModelDefinition[] = [
  { id: "claude-3-haiku", label: "Claude 3 Haiku", badge: "Fast", provider: "bedrock", providerModel: "anthropic.claude-3-haiku-20240307-v1:0", tier: "free" },
  { id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet", badge: "Pro", provider: "bedrock", providerModel: "anthropic.claude-3-5-sonnet-20240620-v1:0", tier: "pro" },
  { id: "gpt-4o", label: "GPT-4o", badge: "Pro", provider: "openai", providerModel: "gpt-4o", tier: "pro" },
  { id: "gemini-flash", label: "Gemini Flash", badge: "Fast", provider: "gemini", providerModel: "gemini-flash-latest", tier: "free", hidden: true },
];

export const DEFAULT_MODEL_ID = "claude-3-haiku";

export function findModel(id: string): ModelDefinition | undefined {
  return MODELS.find((model) => model.id === id);
}

/** Lets tests swap vendors for a scripted provider. */
export const AI_PROVIDERS = Symbol("AI_PROVIDERS");

@Injectable()
export class AiService {
  private readonly providers: Map<AiProviderId, AiProvider>;

  constructor(config: ConfigService<Env, true>, @Optional() @Inject(AI_PROVIDERS) providers?: AiProvider[]) {
    const list = providers ?? [
      new BedrockProvider({
        region: config.get("AWS_REGION", { infer: true }),
        accessKeyId: config.get("AWS_ACCESS_KEY_ID", { infer: true }),
        secretAccessKey: config.get("AWS_SECRET_ACCESS_KEY", { infer: true }),
      }),
      new GeminiProvider(config.get("GEMINI_API_KEY", { infer: true })),
    ];
    this.providers = new Map(list.map((provider) => [provider.id, provider]));
  }

  /** What the model selector shows. Pro models are listed but locked until plans exist. */
  catalogue(): CopilotModelSummary[] {
    return MODELS.filter((model) => !model.hidden).map((model) => ({
      id: model.id,
      label: model.label,
      badge: model.badge,
      tier: model.tier,
      locked: model.tier !== "free",
      available: model.tier === "free" && Boolean(this.providers.get(model.provider)?.configured()),
      default: model.id === DEFAULT_MODEL_ID,
    }));
  }

  async generate(modelId: string, request: Omit<AiRequest, "providerModel">): Promise<AiResult & { model: ModelDefinition }> {
    const model = findModel(modelId);
    if (!model) throw new AiProviderError("bedrock", `Unknown model ${modelId}`, false, "UNKNOWN_MODEL");
    const provider = this.providers.get(model.provider);
    if (!provider?.configured()) throw new AiProviderError(model.provider, `${model.label} isn't available right now.`, false, "NOT_CONFIGURED");
    const result = await provider.generate({ ...request, providerModel: model.providerModel });
    return { ...result, model };
  }
}
