import { z } from "zod";
import type { AiProviderId } from "./ai-provider";

/** One way to reach a model: a provider and that provider's name for it. */
export interface ModelRoute {
  provider: AiProviderId;
  providerModel: string;
}

/**
 * Every model Plinth AI can use, declared as data. Adding a model is one entry here, or one entry in AI_MODELS. A model
 * is reached through its first configured route (`provider`/`providerModel`, then `alternates`); when every route
 * fails, the request moves on to `fallbacks`, each sized for the model that ends up answering.
 */
export interface ModelDefinition extends ModelRoute {
  /** Stable id stored with each chat message. Never reuse an id for a different model. */
  id: string;
  label: string;
  badge: string;
  /** Other providers serving the same model, tried in order after the first. */
  alternates?: ModelRoute[];
  tier: "free" | "pro";
  /** Kept in the registry (usable as a fallback or by configuration) but not offered in the selector. */
  hidden?: boolean;
  /** Models to try, in order, when every route of this one fails. */
  fallbacks?: string[];
  /** How much site source (characters) one request may carry. */
  contextChars: number;
  maxOutputTokens: number;
}

/**
 * Budgets by kind of model. Groq's free tier allows ~8k tokens per minute and counts max_tokens against it. Replies
 * are edits, not essays: 6K output tokens covers the largest allowed change without reserving credit that pay-as-you-go
 * accounts would refuse.
 */
export const BUDGET = {
  freeTier: { contextChars: 11_000, maxOutputTokens: 1_500 },
  openFree: { contextChars: 24_000, maxOutputTokens: 4_000 },
  large: { contextChars: 120_000, maxOutputTokens: 6_000 },
} as const;

/** The model behind the free tier is configuration (`GROQ_MODEL`). */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/** Display names, so the selector always names the model that actually answers. */
const GROQ_LABELS: Record<string, string> = {
  "openai/gpt-oss-120b": "GPT-OSS 120B",
  "openai/gpt-oss-20b": "GPT-OSS 20B",
  "llama3-70b-8192": "Llama 3 70B",
  "llama-3.3-70b-versatile": "Llama 3.3 70B",
};

export const DEFAULT_MODEL_ID = "free";

export function buildModels(options: { groqModel?: string; overrides?: string } = {}): ModelDefinition[] {
  const groqModel = options.groqModel || DEFAULT_GROQ_MODEL;
  const defaults: ModelDefinition[] = [
    // Free: Groq first; NVIDIA's hosted Llama takes over when Groq is rate limited or down.
    { id: "free", label: GROQ_LABELS[groqModel] ?? groqModel, badge: "Free", provider: "groq", providerModel: groqModel, tier: "free", fallbacks: ["nvidia-llama-3.3-70b"], ...BUDGET.freeTier },
    { id: "nvidia-llama-3.3-70b", label: "Llama 3.3 70B", badge: "Free", provider: "nvidia", providerModel: "meta/llama-3.3-70b-instruct", tier: "free", hidden: true, fallbacks: [], ...BUDGET.openFree },
    // Pro: direct vendor keys first, then the resellers. The id stays "claude-3-5-sonnet" so earlier messages keep resolving.
    // AgentRouter is last on purpose — it is a shared credit pool, so it is the route that keeps Pro answering when no
    // direct key is set, not the one we'd choose first. Correct its model ids from AI_MODELS without a deploy.
    {
      id: "claude-3-5-sonnet",
      label: "Claude Sonnet 5",
      badge: "Pro",
      provider: "anthropic",
      providerModel: "claude-sonnet-5",
      tier: "pro",
      // Opus is a different model, so it is a fallback and not an alternate: the reply is then recorded as Opus
      // answering, and the editor says so, instead of the history claiming Sonnet wrote something it didn't.
      fallbacks: ["claude-opus-5", "gpt-4o", "free"],
      ...BUDGET.large,
    },
    {
      id: "gpt-4o",
      label: "GPT-4o",
      badge: "Pro",
      provider: "openai",
      providerModel: "gpt-4o",
      alternates: [{ provider: "openrouter", providerModel: "openai/gpt-4o" }],
      tier: "pro",
      fallbacks: ["claude-3-5-sonnet", "free"],
      ...BUDGET.large,
    },
    { id: "deepseek-v4", label: "DeepSeek V4 Flash", badge: "Pro", provider: "agentrouter", providerModel: "deepseek-v4-flash", tier: "pro", fallbacks: ["free"], ...BUDGET.large },
    // Opus through a direct key when there is one, through the shared pool otherwise — the same model either way,
    // which is what makes this an alternate rather than a fallback.
    {
      id: "claude-opus-5",
      label: "Claude Opus 5",
      badge: "Pro",
      provider: "anthropic",
      providerModel: "claude-opus-5",
      alternates: [{ provider: "agentrouter", providerModel: "claude-opus-5" }],
      tier: "pro",
      fallbacks: ["claude-3-5-sonnet", "free"],
      ...BUDGET.large,
    },
    // Configured but not offered today.
    { id: "claude-3-haiku", label: "Claude 3 Haiku", badge: "Fast", provider: "bedrock", providerModel: "anthropic.claude-3-haiku-20240307-v1:0", tier: "free", hidden: true, fallbacks: [], ...BUDGET.large },
    { id: "gemini-flash", label: "Gemini Flash", badge: "Fast", provider: "gemini", providerModel: "gemini-flash-latest", tier: "free", hidden: true, fallbacks: [], ...BUDGET.large },
  ];
  return options.overrides ? applyModelOverrides(defaults, options.overrides) : defaults;
}

const routeSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) });
const overrideSchema = z.array(
  z.object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(60).optional(),
    badge: z.string().max(12).optional(),
    tier: z.enum(["free", "pro"]).optional(),
    hidden: z.boolean().optional(),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    alternates: z.array(routeSchema).optional(),
    fallbacks: z.array(z.string()).optional(),
    contextChars: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
  }),
);

/**
 * AI_MODELS: a JSON array that edits or extends the defaults. An entry with an existing id changes only the fields it
 * gives (`alternates` and `fallbacks` are replaced whole); a new id needs label, tier, provider and model.
 *
 *   [{"id":"claude-3-5-sonnet","alternates":[{"provider":"openrouter","model":"anthropic/claude-sonnet-4.5"}]},
 *    {"id":"deepseek","label":"DeepSeek V3","tier":"pro","provider":"agentrouter","model":"deepseek-v3"}]
 */
export function applyModelOverrides(defaults: ModelDefinition[], json: string): ModelDefinition[] {
  const entries = overrideSchema.parse(JSON.parse(json));
  const models = defaults.map((model) => ({ ...model }));
  for (const entry of entries) {
    const { model: providerModel, alternates, ...rest } = entry;
    const patch: Partial<ModelDefinition> = {
      ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
      ...(providerModel ? { providerModel } : {}),
      ...(alternates ? { alternates: alternates.map((route) => ({ provider: route.provider, providerModel: route.model })) } : {}),
    };
    const existing = models.find((model) => model.id === entry.id);
    if (existing) {
      Object.assign(existing, patch);
      continue;
    }
    if (!entry.label || !entry.tier || !entry.provider || !providerModel) {
      throw new Error(`AI_MODELS: new model "${entry.id}" needs label, tier, provider and model.`);
    }
    const budget = entry.tier === "pro" ? BUDGET.large : BUDGET.openFree;
    const created = { ...budget, ...(patch as ModelDefinition) };
    created.badge ??= entry.tier === "pro" ? "Pro" : "Free";
    created.fallbacks ??= entry.tier === "pro" ? ["free"] : [];
    models.push(created);
  }
  return models;
}

/** Every route of a model, in the order they're tried. */
export function routesOf(model: ModelDefinition): ModelRoute[] {
  return [{ provider: model.provider, providerModel: model.providerModel }, ...(model.alternates ?? [])];
}
