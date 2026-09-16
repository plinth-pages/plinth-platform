"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { ApiError, api } from "@/lib/api";

type Mode = "signup" | "signin";

const field =
  "h-11 w-full rounded-[10px] border-0 bg-white px-3.5 text-[15px] shadow-[0_0_0_1px_rgb(28_25_23/0.12),0_1px_2px_rgb(28_25_23/0.05)] transition-shadow placeholder:text-stone-400 focus-visible:shadow-[0_0_0_1px_rgb(76_98_220),0_0_0_4px_rgb(76_98_220/0.15)] focus-visible:outline-none dark:bg-stone-900 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.1)]";

/** Email sign-up and sign-in. Signing up signs in at once — no confirmation email — and goes straight to onboarding. */
export function AuthForms({ githubUrl, initialMode = "signup" }: { githubUrl: string; initialMode?: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(true);
  /** Set once sign-up has emailed a confirmation link, or sign-in was refused for an unconfirmed address. */
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [notConfirmed, setNotConfirmed] = useState(false);

  useEffect(() => {
    api.authMethods().then((methods) => setEmailEnabled(methods.email), () => undefined);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    setNotConfirmed(false);
    try {
      const result = mode === "signup" ? await api.register(values) : await api.login({ email: values.email, password: values.password });
      if ("confirmEmail" in result) {
        setPendingEmail(result.confirmEmail);
        setBusy(false);
        return;
      }
      router.replace(result.next);
    } catch (e) {
      if (e instanceof ApiError && e.body?.fields) setFields(e.body.fields as Record<string, string>);
      if (e instanceof ApiError && e.body?.code === "email_not_confirmed") setNotConfirmed(true);
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  if (pendingEmail) {
    return (
      <CheckInbox
        email={pendingEmail}
        onBack={() => {
          setPendingEmail(null);
          setMode("signin");
          setValues((current) => ({ ...current, password: "" }));
        }}
      />
    );
  }

  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="mt-8 flex flex-col gap-5">
      {emailEnabled ? (
        <>
          <div role="tablist" aria-label="Account" className="grid grid-cols-2 rounded-xl bg-stone-100 p-1 text-sm ring-1 ring-stone-200/70 dark:bg-stone-900 dark:ring-white/10">
            {(["signup", "signin"] as const).map((id) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={mode === id}
                onClick={() => (setMode(id), setError(null), setFields({}))}
                className={`h-9 rounded-lg font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none ${
                  mode === id ? "bg-white text-stone-900 shadow-[0_1px_2px_rgb(28_25_23/0.08),0_0_0_1px_rgb(28_25_23/0.06)] dark:bg-stone-800 dark:text-white" : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
                }`}
              >
                {id === "signup" ? "Sign up" : "Sign in"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
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
            {error && !Object.keys(fields).length ? (
              <div role="alert" className="flex flex-col gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
                <p>{error}</p>
                {notConfirmed ? (
                  <button type="button" onClick={() => setPendingEmail(values.email.trim().toLowerCase())} className="w-fit font-medium underline underline-offset-2">
                    Send the confirmation email again
                  </button>
                ) : null}
              </div>
            ) : null}
            <Button type="submit" disabled={busy} variant="brand" size="lg" full className="mt-2">
              {busy ? (mode === "signup" ? "Creating your account…" : "Signing in…") : mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>

          <div className="flex items-center gap-3 text-xs text-stone-400">
            <span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" /> or <span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
          </div>
        </>
      ) : null}

      <a href={githubUrl} className={buttonClass({ variant: "secondary", size: "lg", full: true })}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="currentColor">
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
        Continue with GitHub
      </a>
    </div>
  );
}

const RESEND_COOLDOWN_SECONDS = 60;

/** After sign-up: where the link went, a way to get another, and a way back. */
function CheckInbox({ email, onBack }: { email: string; onBack: () => void }) {
  const [cooldown, setCooldown] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function resend() {
    setStatus(null);
    try {
      await api.resendConfirmation(email);
      setStatus("Sent. It can take a minute to arrive.");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Couldn't send it just now. Please try again.");
    }
  }

  return (
    <div className="mt-8 flex flex-col gap-5">
      <div className="rounded-2xl bg-stone-50 p-5 ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-white/10">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 dark:bg-brand-950 dark:text-brand-300 dark:ring-brand-900">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
          </svg>
        </span>
        <h2 className="mt-4 text-lg font-semibold tracking-tight">Check your inbox</h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
          We sent a confirmation link to <span className="font-medium break-all text-stone-900 dark:text-white">{email}</span>. Open it on this device to finish creating your account.
        </p>
        <p className="mt-3 text-[13px] text-stone-500">Can&apos;t find it? Check your spam or promotions folder.</p>
      </div>

      <Button type="button" variant="secondary" size="lg" full disabled={cooldown > 0} onClick={() => void resend()}>
        {cooldown > 0 ? `Send again in ${cooldown}s` : "Send the email again"}
      </Button>
      {status ? (
        <p role="status" className="text-center text-sm text-stone-600 dark:text-stone-400">
          {status}
        </p>
      ) : null}
      <button type="button" onClick={onBack} className="mx-auto text-sm font-medium text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline dark:hover:text-white">
        Already confirmed? Sign in
      </button>
    </div>
  );
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-stone-700 dark:text-stone-300">{label}</span>
      {children}
      {error ? <span className="text-xs text-red-700 dark:text-red-300">{error}</span> : hint ? <span className="text-xs text-stone-500">{hint}</span> : null}
    </label>
  );
}
