import { z } from "zod";

const url = z.string().url();

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    ORCHESTRATOR_ROLE: z.enum(["api", "worker"]),
    PORT: z.coerce.number().int().positive().default(4000),

    DATABASE_URL: url,
    REDIS_URL: url,

    API_URL: url,
    ADMIN_URL: url,

    // Required by the api role only; the worker never handles sign-in.
    SESSION_SECRET: z.string().min(32).optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    ADMIN_GITHUB_LOGINS: z.string().default(""),
  })
  .superRefine((env, ctx) => {
    if (env.ORCHESTRATOR_ROLE !== "api") return;
    for (const key of ["SESSION_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "Required when ORCHESTRATOR_ROLE=api",
        });
      }
    }
  });

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
