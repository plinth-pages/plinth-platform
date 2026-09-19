import { z } from "zod";

const url = z.string().url();

function isJsonArray(value: string): boolean {
  try {
    return Array.isArray(JSON.parse(value));
  } catch {
    return false;
  }
}

const API_ONLY = ["SESSION_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"] as const;
const WORKER_ONLY = ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "E2B_API_KEY"] as const;

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    ORCHESTRATOR_ROLE: z.enum(["api", "worker"]),
    PORT: z.coerce.number().int().positive().default(4000),

    DATABASE_URL: url,
    REDIS_URL: url,

    API_URL: url,
    ADMIN_URL: url,

    // Sign-in — api role only.
    SESSION_SECRET: z.string().min(32).optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    ADMIN_GITHUB_LOGINS: z.string().default(""),

    // Repository provisioning.
    GITHUB_ORG: z.string().default("plinth-pages"),
    GITHUB_TEMPLATE_REPO: z.string().default("plinth-template"),
    /**
     * Visibility of newly provisioned portfolio repositories. `public` lets Vercel's Hobby plan deploy them (Hobby
     * can't deploy private repositories owned by an organisation); switch to `private` on Vercel Pro. Existing
     * repositories are not changed.
     */
    PORTFOLIO_REPO_VISIBILITY: z.enum(["public", "private"]).default("private"),
    /** Vendored integration packages (worker). Defaults to ../integrations beside the backend. */
    INTEGRATIONS_DIR: z.string().optional(),
    // The GitHub App that creates portfolio repositories — worker role only.
    GITHUB_APP_ID: z.string().regex(/^\d+$/, "Must be the numeric App ID").optional(),
    /** Base64 of the App's PEM private key, so it fits on one .env line. */
    GITHUB_APP_PRIVATE_KEY: z
      .string()
      .refine(
        (value) => /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(Buffer.from(value, "base64").toString("utf8")),
        "Must be the base64-encoded PEM private key",
      )
      .optional(),

    // Preview sandboxes — worker role only. The timers are deliberately short: running sandboxes are billed per
    // second, a paused one costs nothing, and resuming takes under a second.
    E2B_API_KEY: z.string().optional(),
    /** Built by scripts/build-e2b-template.js. */
    E2B_TEMPLATE: z.string().default("plinth-portfolio"),
    SANDBOX_IDLE_PAUSE_MINUTES: z.coerce.number().positive().default(5),
    SANDBOX_DESTROY_AFTER_PAUSED_HOURS: z.coerce.number().positive().default(24),
    /** E2B Hobby caps continuous runtime at 1 hour; an active sandbox is paused and resumed before then to reset it. */
    SANDBOX_ROTATE_AFTER_MINUTES: z.coerce.number().positive().max(55).default(50),

    // Preview proxy — api role. Sandboxes reject traffic without their access token, so browsers reach a preview
    // through an unguessable, expiring hostname served here, which adds the token.
    PREVIEW_PROXY_PORT: z.coerce.number().int().positive().default(4100),
    /** `{session}` becomes the session label. Needs wildcard DNS in production; `*.localhost` works locally. */
    PREVIEW_URL_TEMPLATE: z
      .string()
      .default("http://{session}.preview.localhost:4100")
      .refine(
        (value) => value.includes("{session}") && URL.canParse(value.replace("{session}", "x")),
        "Must be a URL whose hostname contains {session}",
      ),

    // Hosting — worker role. Without a token, Publish still promotes draft to main but deploys nothing.
    /** vercel.com/account/settings/tokens. Scope it to the team or account that owns the portfolio projects. */
    VERCEL_TOKEN: z.string().optional(),
    /** Only for a Vercel team; leave unset for a personal (Hobby) account. */
    VERCEL_TEAM_ID: z.string().optional(),
    // AI co-pilot. Bedrock uses the standard AWS variable names; any provider left unset is simply unavailable.
    AWS_REGION: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    GROQ_API_KEY: z.string().optional(),
    /** OpenRouter (openrouter.ai): one key for many vendors' models, billed from prepaid credit. */
    OPENROUTER_API_KEY: z.string().optional(),
    /** NVIDIA API catalog (build.nvidia.com): hosted open models, used as the free tier's fallback. */
    NVIDIA_API_KEY: z.string().optional(),
    /** AgentRouter: a third-party shared-credit pool. Only models that name it in AI_MODELS use it. */
    AGENTROUTER_API_KEY: z.string().optional(),
    AGENTROUTER_BASE_URL: z.string().url().default("https://agentrouter.org/v1"),
    /** JSON array editing or extending the model list — see applyModelOverrides in src/ai/ai-models.ts. */
    AI_MODELS: z.string().optional().refine((value) => value === undefined || isJsonArray(value), "Must be a JSON array"),
    /** JSON array of extra OpenAI-compatible services: [{"id","baseUrl","apiKeyEnv"}]. */
    AI_PROVIDERS: z.string().optional().refine((value) => value === undefined || isJsonArray(value), "Must be a JSON array"),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    // Billing (Phase 14). Without a price id, checkout creates the $15/month Pro price inline.
    /** Razorpay Standard Checkout: how Pro is paid for (UPI, cards — Indian and international, netbanking, wallets). Key secret stays on the server. */
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    /** The one-month pass, in the currency's smallest unit. 120000 = ₹1,200. */
    RAZORPAY_PRO_PRICE_PAISE: z.coerce.number().int().min(100).default(120_000),
    /** The twelve-month pass. 1200000 = ₹12,000, so a year costs ten months. */
    RAZORPAY_PRO_YEAR_PRICE_PAISE: z.coerce.number().int().min(100).default(1_200_000),
    /** Signs the webhook Razorpay posts to /v1/billing/razorpay/webhook. Set it to the secret you typed in the Razorpay dashboard. */
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    /** The currency Razorpay charges in. Anything other than INR needs that currency enabled on the Razorpay account. */
    RAZORPAY_CURRENCY: z.string().length(3).toUpperCase().default("INR"),
    /** Replaces the passes above entirely: [{"id","label","days","amount"}], amount in the smallest unit. */
    RAZORPAY_PASSES: z.string().optional().refine((value) => value === undefined || isJsonArray(value), "Must be a JSON array"),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRO_PRICE_ID: z.string().optional(),
    /** Emails that get the admin role when they sign in with email and password. */
    ADMIN_EMAILS: z.string().default(""),
    // Email sign-in (Supabase Auth). SUPABASE_URL defaults to the project the database belongs to.
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    /** The Groq model behind the free tier. */
    GROQ_MODEL: z.string().optional(),
    /** NVIDIA's hosted model for the free tier's second chance. Hosted models are retired; this is how to move on. */
    NVIDIA_MODEL: z.string().optional(),
    COPILOT_DAILY_MESSAGES: z.coerce.number().int().positive().default(40),
    // Credential vault (Phase 12): "id:base64-32-byte-key[,id:key…]". The active key seals new secrets; older keys
    // stay listed until every secret sealed with them has been re-saved.
    CREDENTIALS_KEYS: z.string().optional(),
    CREDENTIALS_ACTIVE_KEY: z.string().optional(),
    /**
     * Set when a trusted edge forwards previews under its own hostname (the Cloudflare Worker in front of Railway): the
     * proxy then reads the preview's hostname from this request header instead of Host. Lowercase, e.g.
     * `x-plinth-preview-host`.
     */
    PREVIEW_HOST_HEADER: z
      .string()
      .regex(/^[a-z0-9-]+$/, "Must be a lowercase header name")
      .optional(),
    /** Incoming webhook for a Slack channel; critical failures are posted there. Unset means no alerts. */
    SLACK_WEBHOOK_URL: z.string().url().optional(),
    /** Public address of this API, for integrations that call it from a visitor's browser (Visitor Counter). */
    PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),
  })
  .superRefine((env, ctx) => {
    const required = env.ORCHESTRATOR_ROLE === "api" ? API_ONLY : WORKER_ONLY;
    for (const key of required) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: requiredMessage(env.ORCHESTRATOR_ROLE, key),
        });
      }
    }
    // This one has a default, so a missing value never reached the check above — and every Visitor Counter installed
    // while it was missing had "http://localhost:4000" compiled into a stranger's browser, where it silently fails.
    if (env.NODE_ENV === "production" && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(env.PUBLIC_API_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PUBLIC_API_URL"],
        message: "Required in production: the public address of this API, e.g. https://api.example.com. Installed integrations call it from a visitor's browser, where localhost is the visitor's own machine.",
      });
    }
  });

function requiredMessage(role: "api" | "worker", key: string): string {
  if (role === "api") return "Required when ORCHESTRATOR_ROLE=api";
  if (key === "E2B_API_KEY") return "Required when ORCHESTRATOR_ROLE=worker (create a key at e2b.dev/dashboard)";
  return "Required when ORCHESTRATOR_ROLE=worker (create the GitHub App at /v1/dev/github-app/new)";
}

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule at boot. A bad environment stops the process before anything listens. */
export function validateEnv(raw: Record<string, unknown>): Env {
  // `FOO=` in a shell or .env file means "not set", and should read as Required, not "Invalid url".
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ""));
  const result = envSchema.safeParse(cleaned);
  if (result.success) return result.data;

  const lines = result.error.issues.map(
    (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
  throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
}

export function adminLogins(env: Pick<Env, "ADMIN_GITHUB_LOGINS">): Set<string> {
  return new Set(
    env.ADMIN_GITHUB_LOGINS.split(",")
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  );
}
