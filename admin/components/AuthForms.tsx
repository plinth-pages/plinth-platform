"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";

type Mode = "signup" | "signin";

const field =
  "h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm placeholder:text-stone-400 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30 focus-visible:outline-none dark:border-stone-700 dark:bg-stone-900";

/** Email sign-up and sign-in. Signing up signs in at once — no confirmation email — and goes straight to onboarding. */
export function AuthForms({ githubUrl }: { githubUrl: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signup");
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(true);

  useEffect(() => {
    api.authMethods().then((methods) => setEmailEnabled(methods.email), () => undefined);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const result = mode === "signup" ? await api.register(values) : await api.login({ email: values.email, password: values.password });
      router.replace(result.next);
    } catch (e) {
      if (e instanceof ApiError && e.body?.fields) setFields(e.body.fields as Record<string, string>);
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="mt-8 flex flex-col gap-5">
      {emailEnabled ? (
        <>
          <div role="tablist" aria-label="Account" className="grid grid-cols-2 rounded-lg bg-stone-200/60 p-1 text-sm dark:bg-stone-800">
            {(["signup", "signin"] as const).map((id) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={mode === id}
                onClick={() => (setMode(id), setError(null), setFields({}))}
                className={`rounded-md py-1.5 font-medium focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none ${
                  mode === id ? "bg-white text-stone-900 shadow-card dark:bg-stone-950 dark:text-stone-100" : "text-stone-600 hover:text-stone-900 dark:text-stone-400"
                }`}
              >
                {id === "signup" ? "Sign up" : "Sign in"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
            {mode === "signup" ? (
              <Field label="Name" error={fields.name}>
                <input value={values.name} onChange={set("name")} autoComplete="name" required maxLength={80} className={field} placeholder="Asha Menon" />
              </Field>
            ) : null}
            <Field label="Email" error={fields.email}>
              <input type="email" value={values.email} onChange={set("email")} autoComplete="email" required maxLength={200} className={field} placeholder="you@example.com" />
            </Field>
            <Field label="Password" error={fields.password} hint={mode === "signup" ? "At least 8 characters." : undefined}>
              <input
                type="password"
                value={values.password}
                onChange={set("password")}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={mode === "signup" ? 8 : 1}
                maxLength={72}
                className={field}
              />
            </Field>
            {error && !Object.keys(fields).length ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="mt-1 h-11 rounded-lg bg-stone-900 text-sm font-medium text-white shadow-card hover:bg-stone-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
            >
              {busy ? (mode === "signup" ? "Creating your account…" : "Signing in…") : mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>

          <div className="flex items-center gap-3 text-xs text-stone-400">
            <span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" /> or <span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
          </div>
        </>
      ) : null}

      <a
        href={githubUrl}
        className="flex h-11 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 text-sm font-medium transition-colors hover:bg-stone-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="currentColor">
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
        Continue with GitHub
      </a>
    </div>
  );
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-red-700 dark:text-red-300">{error}</span> : hint ? <span className="text-xs text-stone-500">{hint}</span> : null}
    </label>
  );
}
