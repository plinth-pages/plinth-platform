import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { Alerts } from "../observability/alerts";
import { ConfigService } from "@nestjs/config";
import type { CopilotModelSummary } from "@plinth-pages/shared";
import { z } from "zod";
import type { Env } from "../config/env";
import { buildModels, DEFAULT_MODEL_ID, routesOf, type ModelDefinition, type ModelRoute } from "./ai-models";
import { AiProviderError, affordableTokens, tooLarge, truncatedAnswer, type AiProvider, type AiProviderId, type AiRequest, type AiResult } from "./ai-provider";
import { AnthropicProvider } from "./anthropic.provider";
import { BedrockProvider } from "./bedrock.provider";
import { GeminiProvider } from "./gemini.provider";
import { GroqProvider } from "./groq.provider";
import { OpenAIProvider } from "./openai.provider";

export { buildModels, DEFAULT_GROQ_MODEL, DEFAULT_MODEL_ID, type ModelDefinition } from "./ai-models";

/** Lets tests swap vendors for a scripted provider. */
export const AI_PROVIDERS = Symbol("AI_PROVIDERS");

/** At most this many model/route calls for one request, so a bad day at every vendor can't stall a request for minutes. */
const MAX_CALLS = 5;

/** A cycle in `fallbacks` is a configuration mistake, not a reason to loop; this bounds the walk regardless. */
const MAX_CHAIN = 8;

const extraProvidersSchema = z.array(
  z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().optional(),
    baseUrl: z.string().url(),
    /** Name of the environment variable holding the key — the key itself never goes in AI_PROVIDERS. */
    apiKeyEnv: z.string().regex(/^[A-Z0-9_]+$/),
    headers: z.record(z.string()).optional(),
  }),
);

/** One line per vendor. A provider without credentials reports `configured() === false` and its routes are skipped. */
export function createProviders(config: ConfigService<Env, true>): AiProvider[] {
  const providers: AiProvider[] = [
    new GroqProvider(config.get("GROQ_API_KEY", { infer: true })),
    new AnthropicProvider(config.get("ANTHROPIC_API_KEY", { infer: true })),
    new OpenAIProvider(config.get("OPENAI_API_KEY", { infer: true })),
    new OpenAIProvider(config.get("OPENROUTER_API_KEY", { infer: true }), undefined, {
      id: "openrouter",
      name: "OpenRouter",
      baseURL: "https://openrouter.ai/api/v1",
      headers: { "HTTP-Referer": config.get("ADMIN_URL", { infer: true }), "X-Title": "Plinth" },
    }),
    new OpenAIProvider(config.get("NVIDIA_API_KEY", { infer: true }), undefined, { id: "nvidia", name: "NVIDIA", baseURL: "https://integrate.api.nvidia.com/v1" }),
    // A third-party pool: only used by models that name it in AI_MODELS.
    new OpenAIProvider(config.get("AGENTROUTER_API_KEY", { infer: true }), undefined, {
      id: "agentrouter",
      name: "AgentRouter",
      baseURL: config.get("AGENTROUTER_BASE_URL", { infer: true }),
    }),
    new BedrockProvider({
      region: config.get("AWS_REGION", { infer: true }),
      accessKeyId: config.get("AWS_ACCESS_KEY_ID", { infer: true }),
      secretAccessKey: config.get("AWS_SECRET_ACCESS_KEY", { infer: true }),
    }),
    new GeminiProvider(config.get("GEMINI_API_KEY", { infer: true })),
  ];
  const extra = config.get("AI_PROVIDERS", { infer: true });
  if (extra) {
    for (const entry of extraProvidersSchema.parse(JSON.parse(extra))) {
      providers.push(new OpenAIProvider(process.env[entry.apiKeyEnv], undefined, { id: entry.id, name: entry.name ?? entry.id, baseURL: entry.baseUrl, headers: entry.headers }));
    }
  }
  return providers;
}

/** What a caller builds for a given model: the prompt sized to `contextChars`. The service sets the model and reply size. */
export type RequestBuilder = (model: ModelDefinition, contextChars: number) => Omit<AiRequest, "providerModel" | "maxTokens">;

export interface GenerateResult extends AiResult {
  /** The model that actually answered — a fallback when `fellBack` is true. */
  model: ModelDefinition;
  provider: AiProviderId;
  fellBack: boolean;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly providers: Map<AiProviderId, AiProvider>;
  readonly models: ModelDefinition[];

  constructor(
    config: ConfigService<Env, true>,
    @Optional() @Inject(AI_PROVIDERS) providers?: AiProvider[],
    @Optional() private readonly alerts?: Alerts,
  ) {
    this.providers = new Map((providers ?? createProviders(config)).map((provider) => [provider.id, provider]));
    this.models = buildModels({ groqModel: config.get("GROQ_MODEL", { infer: true }), overrides: config.get("AI_MODELS", { infer: true }) });
  }

  findModel(id: string): ModelDefinition | undefined {
    return this.models.find((model) => model.id === id);
  }

  private reachable(model: ModelDefinition): boolean {
    return routesOf(model).some((route) => this.providers.get(route.provider)?.configured());
  }

  /** What the model selector shows for a plan: Pro models are locked on Free, and unavailable until a route is configured. */
  catalogue(plan: "free" | "pro" = "free"): CopilotModelSummary[] {
    return this.models
      .filter((model) => !model.hidden)
      .map((model) => ({
        id: model.id,
        label: model.label,
        badge: model.badge,
        tier: model.tier,
        locked: model.tier === "pro" && plan !== "pro",
        available: (model.tier === "free" || plan === "pro") && this.reachable(model),
        default: model.id === DEFAULT_MODEL_ID,
      }));
  }

  /**
   * Answers with the requested model if any of its routes works, otherwise with its fallbacks in order. Each call is
   * sized for the model making it; a "too large" answer is retried with half the context, and a low-credit refusal
   * with the reply size the account can afford, before moving on.
   */
  async generate(modelId: string, build: RequestBuilder | Omit<AiRequest, "providerModel">): Promise<GenerateResult> {
    const requested = this.findModel(modelId);
    if (!requested) throw new AiProviderError("plinth", `Unknown model ${modelId}`, false, "UNKNOWN_MODEL");
    const builder: RequestBuilder = typeof build === "function" ? build : () => build;
    const fixedMaxTokens = typeof build === "function" ? undefined : build.maxTokens;

    // Fallbacks are followed all the way down, not one step. A Pro request that ends up on the free model must still
    // reach that model's own fallback: stopping a step short is how a request died on the smallest model in the list
    // while a larger free one sat unused behind it.
    const chain: ModelDefinition[] = [];
    const queue = [requested];
    while (queue.length > 0 && chain.length < MAX_CHAIN) {
      const model = queue.shift()!;
      if (chain.includes(model)) continue;
      chain.push(model);
      for (const id of model.fallbacks ?? []) {
        const next = this.findModel(id);
        if (next && !chain.includes(next)) queue.push(next);
      }
    }

    let calls = 0;
    let lastError: unknown = null;
    // Every route that refused, in order. Without it an alert names only the last provider tried, which is the
    // smallest fallback — and says nothing about why the model the user actually picked didn't answer.
    const attempts: string[] = [];
    for (const [modelIndex, model] of chain.entries()) {
      for (const [routeIndex, route] of routesOf(model).entries()) {
        const provider = this.providers.get(route.provider);
        if (!provider?.configured()) {
          attempts.push(`${model.id} via ${route.provider}: no key`);
          lastError ??= new AiProviderError(route.provider, `${model.label} isn't available right now.`, false, "NOT_CONFIGURED");
          continue;
        }
        if (calls >= MAX_CALLS) break;
        calls += 1;
        try {
          const result = await this.call(provider, route, model, builder, fixedMaxTokens);
          const fellBack = modelIndex > 0 || routeIndex > 0;
          if (fellBack) this.logger.warn(`Answered ${modelId} with ${model.id} via ${route.provider}`);
          return { ...result, model, provider: route.provider, fellBack };
        } catch (error) {
          if (!(error instanceof AiProviderError)) throw error;
          lastError = error;
          attempts.push(`${model.id} via ${route.provider}: ${error.code ?? "error"} ${error.message.slice(0, 80)}`);
          this.logger.warn(`${model.id} via ${route.provider} failed (${error.code ?? "error"}): ${error.message.slice(0, 200)}`);
          // Out of credit (402) or throttled (429) needs a person to act, even if a fallback answered this request.
          if (error.code === "402" || error.code === "429") {
            this.alerts?.send({
              title: error.code === "402" ? "AI provider out of credit" : "AI provider is rate limiting us",
              error,
              level: "warning",
              dedupeKey: `ai:${route.provider}:${error.code}`,
              fields: { provider: route.provider, model: model.id, requested: modelId },
            });
          }
        }
      }
    }
    const failure = lastError ?? new AiProviderError("plinth", `${requested.label} isn't available right now.`, false, "NOT_CONFIGURED");
    if (failure instanceof AiProviderError) failure.attempts = attempts;
    throw failure;
  }

  private async call(provider: AiProvider, route: ModelRoute, model: ModelDefinition, build: RequestBuilder, fixedMaxTokens?: number): Promise<AiResult> {
    const maxTokens = fixedMaxTokens ?? model.maxOutputTokens;
    const once = (contextChars: number, tokens: number) => provider.generate({ ...build(model, contextChars), providerModel: route.providerModel, maxTokens: tokens });
    try {
      return await once(model.contextChars, maxTokens);
    } catch (error) {
      if (tooLarge(error)) return once(Math.floor(model.contextChars / 2), maxTokens);
      // A cut-off answer means the model was given more to change than its reply could describe. Half the context is
      // half the site, so it attempts a smaller change that fits — better than telling someone to try again later.
      if (truncatedAnswer(error)) return once(Math.floor(model.contextChars / 2), maxTokens);
      const affordable = affordableTokens(error);
      if (affordable && affordable < maxTokens) return once(model.contextChars, affordable);
      throw error;
    }
  }
}
