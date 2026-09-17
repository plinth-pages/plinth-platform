"use client";

import type { AdminPromoCode, CreatePromoCodeRequest, PromoDuration } from "@plinth-pages/shared";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";

const VALIDITY: { label: string; hours: number | null }[] = [
  { label: "24 hours", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
  { label: "No expiry", hours: null },
];

const STATUS: Record<AdminPromoCode["status"], { label: string; tone: string }> = {
  active: { label: "Active", tone: "bg-emerald-400/15 text-emerald-300" },
  expired: { label: "Expired", tone: "bg-white/10 text-stone-400" },
  used_up: { label: "Used up", tone: "bg-amber-400/15 text-amber-300" },
  inactive: { label: "Switched off", tone: "bg-white/10 text-stone-500" },
};

// color-scheme makes the browser draw native parts (select menus, number spinners) dark; options get an explicit dark fill.
const input =
  "h-10 w-full rounded-lg border-0 bg-white/[0.04] px-3 text-sm text-white ring-1 ring-white/10 [color-scheme:dark] placeholder:text-stone-500 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none [&>option]:bg-stone-900 [&>option]:text-white";

/** Issue and track discount codes for launches, partners and referrals. */
export default function PromoCodesPage() {
  const [codes, setCodes] = useState<AdminPromoCode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", percentOff: "20", duration: "once" as PromoDuration, durationMonths: "3", validity: "24", maxRedemptions: "", note: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => api.adminPromoCodes().then((r) => setCodes(r.codes), (e) => setError(e instanceof Error ? e.message : "Couldn't load codes.")), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFields({});
    setError(null);
    const body: CreatePromoCodeRequest = {
      code: form.code.trim() || undefined,
      percentOff: Number(form.percentOff),
      duration: form.duration,
      durationMonths: form.duration === "repeating" ? Number(form.durationMonths) : undefined,
      validForHours: form.validity ? Number(form.validity) : undefined,
      maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : undefined,
      note: form.note.trim() || undefined,
    };
    try {
      await api.createPromoCode(body);
      setForm((current) => ({ ...current, code: "", note: "" }));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.body?.fields) setFields(e.body.fields as Record<string, string>);
      setError(e instanceof Error ? e.message : "Couldn't create the code.");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink(code: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/billing?code=${encodeURIComponent(code)}`);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  }

  async function switchOff(id: string) {
    await api.deactivatePromoCode(id).catch((e) => setError(e instanceof Error ? e.message : "Couldn't switch it off."));
    void load();
  }

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Promo codes</h1>
        <p className="mt-1 text-sm text-stone-400">
          Discounts on Pro for launches, partners and referrals. Stripe enforces the percentage, expiry and use limit; share the link or the code.
        </p>
      </header>

      <form onSubmit={create} className="grid gap-4 rounded-2xl bg-white/[0.03] p-5 ring-1 ring-white/10 md:grid-cols-6">
        <Field label="Code" hint="Leave empty to generate" error={fields.code} className="md:col-span-2">
          <input value={form.code} onChange={(e) => setForm((c) => ({ ...c, code: e.target.value.toUpperCase() }))} placeholder="LAUNCH20" maxLength={30} className={`${input} font-mono tracking-wider`} />
        </Field>
        <Field label="Discount" error={fields.percentOff}>
          <div className="relative">
            <input type="number" min={1} max={100} value={form.percentOff} onChange={set("percentOff")} className={`${input} pr-8`} />
            <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-stone-500">%</span>
          </div>
        </Field>
        <Field label="Applies to" className="md:col-span-2" error={fields.durationMonths}>
          <div className="flex gap-2">
            <select value={form.duration} onChange={set("duration")} className={input}>
              <option value="once">First payment</option>
              <option value="repeating">First N months</option>
              <option value="forever">Every payment</option>
            </select>
            {form.duration === "repeating" ? <input type="number" min={1} max={36} value={form.durationMonths} onChange={set("durationMonths")} aria-label="Months" className={`${input} w-20`} /> : null}
          </div>
        </Field>
        <Field label="Valid for">
          <select value={form.validity} onChange={set("validity")} className={input}>
            {VALIDITY.map((v) => (
              <option key={v.label} value={v.hours ?? ""}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Max uses" hint="Empty = unlimited" error={fields.maxRedemptions}>
          <input type="number" min={1} value={form.maxRedemptions} onChange={set("maxRedemptions")} placeholder="∞" className={input} />
        </Field>
        <Field label="Note" hint="Who or what it's for" className="md:col-span-4">
          <input value={form.note} onChange={set("note")} maxLength={120} placeholder="Referral: Rahul · Launch tweet · College partner" className={input} />
        </Field>
        <div className="flex items-end md:col-span-1">
          <button type="submit" disabled={saving} className="h-10 w-full rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-60">
            {saving ? "Creating…" : "Create code"}
          </button>
        </div>
        {error ? <p className="text-sm text-red-300 md:col-span-6">{error}</p> : null}
      </form>

      <section className="overflow-x-auto rounded-2xl ring-1 ring-white/10">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-white/[0.03] text-xs text-stone-400">
            <tr>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Discount</th>
              <th className="px-4 py-3 font-medium">Uses</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {codes === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-stone-500">
                  Loading…
                </td>
              </tr>
            ) : codes.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-stone-500">
                  No codes yet. Create one above.
                </td>
              </tr>
            ) : (
              codes.map((c) => (
                <tr key={c.id} className="border-t border-white/5 align-top">
                  <td className="px-4 py-3">
                    <p className="font-mono font-semibold tracking-wider text-white">{c.code}</p>
                    {c.note ? <p className="mt-0.5 text-xs text-stone-500">{c.note}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-stone-300">
                    {c.percentOff}% · {c.duration === "forever" ? "every payment" : c.duration === "repeating" ? `${c.durationMonths} months` : "first payment"}
                  </td>
                  <td className="px-4 py-3 text-stone-300 tabular-nums">
                    {c.timesRedeemed}
                    {c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}
                  </td>
                  <td className="px-4 py-3 text-stone-400">{c.expiresAt ? new Date(c.expiresAt).toLocaleString() : "Never"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[c.status].tone}`}>{STATUS[c.status].label}</span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button type="button" onClick={() => void copyLink(c.code)} className="rounded-md px-2 py-1 text-xs font-medium text-stone-300 ring-1 ring-white/10 hover:bg-white/10">
                      {copied === c.code ? "Copied" : "Copy link"}
                    </button>
                    {c.status === "active" ? (
                      <button type="button" onClick={() => void switchOff(c.id)} className="ml-2 rounded-md px-2 py-1 text-xs font-medium text-red-300 ring-1 ring-red-400/20 hover:bg-red-400/10">
                        Switch off
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Field({ label, hint, error, className = "", children }: { label: string; hint?: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-medium text-stone-300">
        {label}
        {hint ? <span className="ml-1 font-normal text-stone-500">· {hint}</span> : null}
      </span>
      {children}
      {error ? <span className="text-xs text-red-300">{error}</span> : null}
    </label>
  );
}
