import type { SecretSpec } from "@plinth-pages/integration-types";

export type VerifyResult = { ok: true } | { ok: false; message: string };

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

/**
 * Checks a secret before it is saved, with a real but harmless call to its provider where there is one. Nothing is
 * sent or created: for Resend it lists domains, which a sending-only key is refused politely and a bad key rejected.
 */
export async function verifySecret(spec: SecretSpec, value: string, fetchImpl: typeof fetch = fetch): Promise<VerifyResult> {
  if (!value.trim()) return { ok: false, message: `${spec.label} is required.` };
  if (value.length > 500) return { ok: false, message: `${spec.label} is too long.` };
  if (/[\r\n]/.test(value)) return { ok: false, message: `${spec.label} can't contain line breaks.` };
  if (spec.kind === "email" && !EMAIL.test(value)) return { ok: false, message: `${spec.label} must be an email address.` };

  if (spec.provider === "resend") {
    if (!/^re_[A-Za-z0-9_]{8,}$/.test(value)) return { ok: false, message: "That doesn't look like a Resend API key (they start with re_)." };
    try {
      const response = await fetchImpl("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${value}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) return { ok: true };
      const body = (await response.json().catch(() => ({}))) as { name?: string };
      // A key limited to sending can't list domains — it is still a valid key, and all the form needs.
      if (body.name === "restricted_api_key") return { ok: true };
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        return { ok: false, message: "Resend didn't accept that key. Check it's copied in full and hasn't been deleted." };
      }
      return { ok: false, message: "Resend couldn't be reached to check the key. Please try again in a moment." };
    } catch {
      return { ok: false, message: "Resend couldn't be reached to check the key. Please try again in a moment." };
    }
  }
  return { ok: true };
}
