import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Envelope for user secrets: AES-256-GCM with a fresh 12-byte IV per value. The ciphertext is bound to where it
 * belongs (portfolio and variable name) as additional authenticated data, so a row copied onto another portfolio or
 * variable fails to decrypt instead of leaking. Every value records the id of the key that sealed it, so keys can
 * be rotated: new values use the active key, old ones still open with the key they name.
 */
export interface SealedSecret {
  ciphertext: string;
  iv: string;
  keyId: string;
}

export class VaultError extends Error {}

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;

export class Vault {
  private readonly keys: Map<string, Buffer>;

  constructor(
    keys: Map<string, Buffer>,
    private readonly activeKeyId: string,
  ) {
    for (const [id, key] of keys) {
      if (!KEY_ID.test(id)) throw new VaultError(`Invalid key id "${id}"`);
      if (key.length !== 32) throw new VaultError(`Key "${id}" must be 32 bytes`);
    }
    if (!keys.has(activeKeyId)) throw new VaultError(`The active key "${activeKeyId}" isn't configured`);
    this.keys = keys;
  }

  /**
   * Parses `CREDENTIALS_KEYS` — `id:base64key[,id:base64key…]` — where the first entry (or `CREDENTIALS_ACTIVE_KEY`)
   * seals new values. Returns null when unset, so the rest of the platform runs without the vault.
   */
  static fromConfig(raw: string | undefined, active: string | undefined): Vault | null {
    if (!raw?.trim()) return null;
    const keys = new Map<string, Buffer>();
    for (const entry of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
      const separator = entry.indexOf(":");
      if (separator <= 0) throw new VaultError("CREDENTIALS_KEYS entries look like id:base64key");
      keys.set(entry.slice(0, separator), Buffer.from(entry.slice(separator + 1), "base64"));
    }
    return new Vault(keys, active || [...keys.keys()][0]);
  }

  seal(plaintext: string, context: string): SealedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.keys.get(this.activeKeyId)!, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
    return { ciphertext: body.toString("base64"), iv: iv.toString("base64"), keyId: this.activeKeyId };
  }

  open(sealed: SealedSecret, context: string): string {
    const key = this.keys.get(sealed.keyId);
    if (!key) throw new VaultError(`The key "${sealed.keyId}" that sealed this secret isn't configured`);
    const body = Buffer.from(sealed.ciphertext, "base64");
    if (body.length < 16) throw new VaultError("Sealed secret is too short");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(body.subarray(body.length - 16));
    try {
      return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString("utf8");
    } catch {
      throw new VaultError("The secret couldn't be decrypted");
    }
  }
}

/** What a sealed value belongs to. Changing this format makes every stored secret unreadable. */
export const secretContext = (portfolioId: string, env: string) => `plinth-credential:v1:${portfolioId}:${env}`;

/** A hint that is safe to show: the last four characters of an API key, or a masked email. */
export function secretHint(value: string, kind: "api_key" | "email" | "text"): string {
  if (kind === "email") {
    const [local, domain] = value.split("@");
    return domain ? `${local.slice(0, 1)}•••@${domain}` : "•••";
  }
  return value.length > 8 ? `•••• ${value.slice(-4)}` : "••••";
}
