import type { AiProviderId } from "./ai-provider";

/**
 * Every model the co-pilot can use, declared as data. Adding a model is one entry here; a model whose provider has
 * no credentials is simply shown as unavailable, and `pro` models stay locked until plans exist (Phase 14).
 */
export interface ModelDefinition {
  /** Stable id stored with each chat message. Never reuse an id for a different model. */
  id: string;
  label: string;
  badge: string;
  provider: AiProviderId;
  /** The vendor's own model identifier. */
  providerModel: string;
  tier: "free" | "pro";
  /** Kept in the registry (and usable by configuration) but not offered in the selector. */
  hidden?: boolean;
  /** How much portfolio source (characters) one request may carry. */
  contextChars: number;
  maxOutputTokens: number;
}

/** Budgets by kind of model. Groq's free tier allows ~8k tokens per minute and counts max_tokens against it. */
export const BUDGET = {
  freeTier: { contextChars: 11_000, maxOutputTokens: 1_500 },
  large: { contextChars: 120_000, maxOutputTokens: 16_000 },
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

export function buildModels(options: { groqModel?: string } = {}): ModelDefinition[] {
  const groqModel = options.groqModel || DEFAULT_GROQ_MODEL;
  return [
    { id: "free", label: GROQ_LABELS[groqModel] ?? groqModel, badge: "Free", provider: "groq", providerModel: groqModel, tier: "free", ...BUDGET.freeTier },
    // Pro: Claude through the Anthropic API (ANTHROPIC_API_KEY). The id stays "claude-3-5-sonnet" so earlier messages keep resolving.
    { id: "claude-3-5-sonnet", label: "Claude Sonnet 5", badge: "Pro", provider: "anthropic", providerModel: "claude-sonnet-5", tier: "pro", ...BUDGET.large },
    { id: "gpt-4o", label: "GPT-4o", badge: "Pro", provider: "openai", providerModel: "gpt-4o", tier: "pro", ...BUDGET.large },
    // Configured but not offered today.
    { id: "claude-opus-5", label: "Claude Opus 5", badge: "Pro", provider: "anthropic", providerModel: "claude-opus-5", tier: "pro", hidden: true, ...BUDGET.large },
    { id: "claude-3-haiku", label: "Claude 3 Haiku", badge: "Fast", provider: "bedrock", providerModel: "anthropic.claude-3-haiku-20240307-v1:0", tier: "free", hidden: true, ...BUDGET.large },
    { id: "gemini-flash", label: "Gemini Flash", badge: "Fast", provider: "gemini", providerModel: "gemini-flash-latest", tier: "free", hidden: true, ...BUDGET.large },
  ];
}
