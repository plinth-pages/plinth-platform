import { z } from "zod";

const url = z.string().url();

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
