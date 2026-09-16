"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ApiError, api, type LegalRequestKind } from "@/lib/api";

const KINDS: { value: LegalRequestKind; label: string }[] = [
  { value: "access", label: "See the data you hold about me" },
  { value: "correction", label: "Correct my data" },
  { value: "deletion", label: "Delete my account and data" },
  { value: "consent_withdrawal", label: "Withdraw my consent" },
  { value: "grievance", label: "Grievance or content report" },
  { value: "other", label: "Something else" },
];

const field =
  "w-full rounded-[10px] border-0 bg-white px-3.5 text-[15px] shadow-[0_0_0_1px_rgb(28_25_23/0.12),0_1px_2px_rgb(28_25_23/0.05)] placeholder:text-stone-400 focus-visible:shadow-[0_0_0_1px_rgb(76_98_220),0_0_0_4px_rgb(76_98_220/0.15)] focus-visible:outline-none dark:bg-stone-900 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.1)]";

export function LegalRequestForm() {
  const [values, setValues] = useState({ kind: "access" as LegalRequestKind, name: "", email: "", message: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ id: string; receivedAt: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      setReceipt(await api.submitLegalRequest(values));
    } catch (e) {
      if (e instanceof ApiError && e.body?.fields) setFields(e.body.fields as Record<string, string>);
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (receipt) {
    return (
      <div role="status" className="rounded-2xl bg-emerald-50 p-6 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:ring-emerald-900">
        <h2 className="text-lg font-semibold text-emerald-900 dark:text-emerald-200">Request received</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-emerald-900/80 dark:text-emerald-200/80">
          We&apos;ll reply to <strong>{values.email}</strong> within 30 days. Your reference is <span className="font-mono">{receipt.id}</span>, submitted{" "}
          {new Date(receipt.receivedAt).toLocaleString()}.
        </p>
      </div>
    );
  }

  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-stone-700 dark:text-stone-300">What do you need?</span>
        <select value={values.kind} onChange={set("kind")} className={`${field} h-11`}>
          {KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <Labelled label="Your name" error={fields.name}>
          <input value={values.name} onChange={set("name")} autoComplete="name" maxLength={120} required className={`${field} h-11`} />
        </Labelled>
        <Labelled label="Email for our reply" error={fields.email}>
          <input type="email" value={values.email} onChange={set("email")} autoComplete="email" maxLength={200} required className={`${field} h-11`} />
        </Labelled>
      </div>
      <Labelled label="Details" error={fields.message}>
        <textarea
          value={values.message}
          onChange={set("message")}
          rows={6}
          maxLength={5000}
          required
          placeholder="Tell us what you need. For content reports, include the page address."
          className={`${field} py-3`}
        />
      </Labelled>
      {error && !Object.keys(fields).length ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p> : null}
      <Button type="submit" variant="brand" size="lg" disabled={busy} className="sm:w-fit">
        {busy ? "Sending…" : "Send request"}
      </Button>
    </form>
  );
}

function Labelled({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-stone-700 dark:text-stone-300">{label}</span>
      {children}
      {error ? <span className="text-xs text-red-700 dark:text-red-300">{error}</span> : null}
    </label>
  );
}
