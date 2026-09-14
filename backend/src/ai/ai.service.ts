import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CopilotModelSummary } from "@plinth-pages/shared";
import type { Env } from "../config/env";
import { AiProviderError, type AiProvider, type AiProviderId, type AiRequest, type AiResult } from "./ai-provider";
import { BedrockProvider } from "./bedrock.provider";
import { GeminiProvider } from "./gemini.provider";
import { GroqProvider } from "./groq.provider";

export interface ModelDefinition {
  id: string;
  label: string;
  badge: string;
  provider: AiProviderId;
  providerModel: string;
  /** `pro` models need a paid plan (Phase 14). */
  tier: "free" | "pro";
  /** Kept in the registry (and usable by configuration) but not offered in the selector. */
  hidden?: boolean;
  /** How much portfolio source (characters) one request may carry. Free tiers have small per-minute token limits. */
  contextChars: number;
  maxOutputTokens: number;
}

const LARGE = { contextChars: 120_000, maxOutputTokens: 4_096 };
/** Groq's free tier allows about 8k tokens per minute per model, and counts max_tokens against it. */
const GROQ_FREE = { contextChars: 11_000, maxOutputTokens: 1_500 };

/** The free model runs on Groq; which Groq model is a configuration choice (`GROQ_MODEL`). */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/** Display names for Groq models, so the selector always names the model that actually answers. */
const GROQ_LABELS: Record<string, string> = {
  "openai/gpt-oss-120b": "GPT-OSS 120B",
  "openai/gpt-oss-20b": "GPT-OSS 20B",
  "llama3-70b-8192": "Llama 3 70B",
  "llama-3.3-70b-versatile": "Llama 3.3 70B",
};

export function buildModels(groqModel: string = DEFAULT_GROQ_MODEL): ModelDefinition[] {
  return [
    { id: "free", label: GROQ_LABELS[groqModel] ?? groqModel, badge: "Free", provider: "groq", providerModel: groqModel, tier: "free", ...GROQ_FREE },
    { id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet", badge: "Pro", provider: "bedrock", providerModel: "anthropic.claude-3-5-sonnet-20240620-v1:0", tier: "pro", ...LARGE },
    { id: "gpt-4o", label: "GPT-4o", badge: "Pro", provider: "openai", providerModel: "gpt-4o", tier: "pro", ...LARGE },
    // Paused providers stay wired up for later.
    { id: "claude-3-haiku", label: "Claude 3 Haiku", badge: "Fast", provider: "bedrock", providerModel: "anthropic.claude-3-haiku-20240307-v1:0", tier: "free", hidden: true, ...LARGE },
    { id: "gemini-flash", label: "Gemini Flash", badge: "Fast", provider: "gemini", providerModel: "gemini-flash-latest", tier: "free", hidden: true, ...LARGE },
  ];
}

export const DEFAULT_MODEL_ID = "free";

/** Lets tests swap vendors for a scripted provider. */
export const AI_PROVIDERS = Symbol("AI_PROVIDERS");

@Injectable()
export class AiService {
  private readonly providers: Map<AiProviderId, AiProvider>;
  readonly models: ModelDefinition[];

  constructor(config: ConfigService<Env, true>, @Optional() @Inject(AI_PROVIDERS) providers?: AiProvider[]) {
    const list = providers ?? [
      new GroqProvider(config.get("GROQ_API_KEY", { infer: true })),
      new BedrockProvider({
        region: config.get("AWS_REGION", { infer: true }),
        accessKeyId: config.get("AWS_ACCESS_KEY_ID", { infer: true }),
        secretAccessKey: config.get("AWS_SECRET_ACCESS_KEY", { infer: true }),
      }),
      new GeminiProvider(config.get("GEMINI_API_KEY", { infer: true })),
    ];
    this.providers = new Map(list.map((provider) => [provider.id, provider]));
    this.models = buildModels(config.get("GROQ_MODEL", { infer: true }) || DEFAULT_GROQ_MODEL);
  }

  findModel(id: string): ModelDefinition | undefined {
    return this.models.find((model) => model.id === id);
  }

  /** What the model selector shows. Pro models are listed but locked until plans exist. */
  catalogue(): CopilotModelSummary[] {
    return this.models
      .filter((model) => !model.hidden)
      .map((model) => ({
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
    const model = this.findModel(modelId);
    if (!model) throw new AiProviderError("groq", `Unknown model ${modelId}`, false, "UNKNOWN_MODEL");
    const provider = this.providers.get(model.provider);
    if (!provider?.configured()) throw new AiProviderError(model.provider, `${model.label} isn't available right now.`, false, "NOT_CONFIGURED");
    const result = await provider.generate({ ...request, providerModel: model.providerModel });
    return { ...result, model };
  }
}
