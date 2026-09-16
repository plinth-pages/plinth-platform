"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { ApiError, api } from "@/lib/api";

type Mode = "signup" | "signin";

const field =
  "h-11 w-full rounded-[10px] border-0 bg-white px-3.5 text-[15px] shadow-[0_0_0_1px_rgb(28_25_23/0.12),0_1px_2px_rgb(28_25_23/0.05)] transition-shadow placeholder:text-stone-400 focus-visible:shadow-[0_0_0_1px_rgb(76_98_220),0_0_0_4px_rgb(76_98_220/0.15)] focus-visible:outline-none dark:bg-stone-900 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.1)]";

const COPY: Record<Mode, { title: string; lead: string; submit: string; busy: string; switchPrompt: string; switchAction: string }> = {
  signup: {
    title: "Start shipping with an AI engineer",
    lead: "Describe what you want. Plinth writes production React, verifies every change, and deploys it — free to start, yours to keep.",
    submit: "Create account",
    busy: "Creating your account…",
    switchPrompt: "Already have an account?",
    switchAction: "Sign in",
  },
  signin: {
    title: "Welcome back",
    lead: "Pick up where you left off. Your editor, your code, your deploys.",
    submit: "Sign in",
    busy: "Signing in…",
    switchPrompt: "New to Plinth?",
    switchAction: "Create an account",
  },
};

/**
 * Sign-in and sign-up: GitHub first, then email. When Supabase requires confirmation, sign-up ends on a
 * "check your inbox" step instead of signing in.
 */
export function AuthForms({ githubUrl, initialMode = "signup", notice }: { githubUrl: string; initialMode?: Mode; notice?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [termsVersion, setTermsVersion] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [consentError, setConsentError] = useState(false);
  /** Set once sign-up has emailed a confirmation link, or sign-in was refused for an unconfirmed address. */
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [notConfirmed, setNotConfirmed] = useState(false);

  useEffect(() => {
    api.authMethods().then((methods) => {
      setEmailEnabled(methods.email);
      setTermsVersion(methods.termsVersion);
    }, () => undefined);
  }, []);

  /** Signing up needs the box ticked; signing in doesn't (anyone missing consent is asked after signing in). */
  function consentOk(): boolean {
    if (mode === "signin" || agreed) return true;
    setConsentError(true);
    return false;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!consentOk()) return;
    setBusy(true);
    setError(null);
    setFields({});
    setNotConfirmed(false);
    try {
      const result = mode === "signup" ? await api.register({ ...values, acceptTerms: agreed }) : await api.login({ email: values.email, password: values.password });
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

  function switchMode() {
    setMode((current) => (current === "signup" ? "signin" : "signup"));
    setConsentError(false);
    setError(null);
    setFields({});
    setNotConfirmed(false);
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

  const copy = COPY[mode];
  const githubHref = mode === "signup" && agreed && termsVersion ? `${githubUrl}?terms=${encodeURIComponent(termsVersion)}` : githubUrl;
  const consent =
    mode === "signup" ? (
      <label
        className={`flex cursor-pointer items-start gap-3 rounded-xl p-3 text-[13px] leading-relaxed ring-1 transition-colors ${
          consentError && !agreed ? "bg-red-50 text-red-900 ring-red-200 dark:bg-red-950/50 dark:text-red-200 dark:ring-red-900" : "bg-stone-50 text-stone-600 ring-stone-200 dark:bg-stone-900 dark:text-stone-400 dark:ring-stone-800"
        }`}
      >
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => {
            setAgreed(event.target.checked);
            setConsentError(false);
          }}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
        />
        <span>
          I agree to the{" "}
          <Link href="/terms" target="_blank" className="font-medium text-stone-900 underline underline-offset-2 dark:text-white">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" className="font-medium text-stone-900 underline underline-offset-2 dark:text-white">
            Privacy Policy
          </Link>
          , understand my site&apos;s code is stored publicly, and I&apos;m 18+ or have my parent or guardian&apos;s consent.
        </span>
      </label>
    ) : null;
  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="flex flex-col">
      <h1 className="text-[32px] leading-[1.1] font-semibold tracking-[-0.035em] text-balance">{copy.title}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-stone-500 dark:text-stone-400">{copy.lead}</p>

      {notice ? (
        <p role="alert" className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900">
          {notice}
        </p>
      ) : null}

      <div className="mt-8 flex flex-col gap-5">
        {consent}
        <a
          href={githubHref}
          onClick={(event) => {
            if (!consentOk()) event.preventDefault();
          }}
          className={buttonClass({ variant: "primary", size: "lg", full: true })}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px]" fill="currentColor">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
          Continue with GitHub
        </a>

        {emailEnabled ? (
          <>
            <div className="flex items-center gap-3 text-[12px] font-medium tracking-wide text-stone-400 uppercase">
              <span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" /> or continue with email <span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
            </div>

            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              {mode === "signup" ? (
                <Field label="Full name" error={fields.name}>
                  <input value={values.name} onChange={set("name")} autoComplete="name" required maxLength={80} className={field} placeholder="Asha Menon" />
                </Field>
              ) : null}
              <Field label="Work or personal email" error={fields.email}>
                <input type="email" value={values.email} onChange={set("email")} autoComplete="email" required maxLength={200} className={field} placeholder="you@company.com" />
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
              <Button type="submit" disabled={busy} variant="brand" size="lg" full className="mt-1">
                {busy ? copy.busy : copy.submit}
              </Button>
            </form>

            {mode === "signin" ? (
              <p className="text-center text-xs leading-relaxed text-stone-400">
                By signing in you agree to our <Link href="/terms" className="underline underline-offset-2">Terms</Link> and{" "}
                <Link href="/privacy" className="underline underline-offset-2">Privacy Policy</Link>.
              </p>
            ) : null}
            <p className="text-center text-sm text-stone-500 dark:text-stone-400">
              {copy.switchPrompt}{" "}
              <button type="button" onClick={switchMode} className="font-medium text-stone-900 underline-offset-4 hover:underline dark:text-white">
                {copy.switchAction}
              </button>
            </p>
          </>
        ) : null}
      </div>
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
