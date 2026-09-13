import { randomBytes } from "crypto";

/** How long a preview link keeps working after the owner's last heartbeat. */
export const PREVIEW_SESSION_TTL_S = 15 * 60;

export interface PreviewSession {
  portfolioId: string;
  userId: string;
}

interface SessionRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ex: "EX", seconds: number): Promise<unknown>;
  expire(key: string, seconds: number): Promise<number>;
}

const LABEL = /^[a-z2-7]{26}$/;
const sessionKey = (label: string) => `plinth:preview-session:${label}`;
const ownerKey = (portfolioId: string, userId: string) => `plinth:preview-session-of:${portfolioId}:${userId}`;

/**
 * Preview links are capability URLs: `https://<label>.preview.<domain>`, where the label is 130 random bits. There is
 * no cookie to share across sites, so the link works inside the IDE's iframe and in a new tab alike. Its safety comes
 * from being unguessable and short-lived — only the owner's authenticated heartbeat extends it, so a leaked link stops
 * working 15 minutes after they close the editor.
 */
export class PreviewSessions {
  constructor(private readonly redis: () => Promise<SessionRedis>) {}

  /** Returns the owner's current label, extended, or mints a new one. */
  async open(portfolioId: string, userId: string): Promise<string> {
    const redis = await this.redis();
    const existing = await redis.get(ownerKey(portfolioId, userId));
    if (existing && (await redis.expire(sessionKey(existing), PREVIEW_SESSION_TTL_S)) === 1) {
      await redis.expire(ownerKey(portfolioId, userId), PREVIEW_SESSION_TTL_S);
      return existing;
    }

    const label = newLabel();
    const session: PreviewSession = { portfolioId, userId };
    await redis.set(sessionKey(label), JSON.stringify(session), "EX", PREVIEW_SESSION_TTL_S);
    await redis.set(ownerKey(portfolioId, userId), label, "EX", PREVIEW_SESSION_TTL_S);
    return label;
  }

  /** The owner's live label, without extending it. */
  async current(portfolioId: string, userId: string): Promise<string | null> {
    const redis = await this.redis();
    const label = await redis.get(ownerKey(portfolioId, userId));
    return label && (await redis.get(sessionKey(label))) ? label : null;
  }

  async resolve(label: string): Promise<PreviewSession | null> {
    if (!LABEL.test(label)) return null;
    const raw = await (await this.redis()).get(sessionKey(label));
    return raw ? (JSON.parse(raw) as PreviewSession) : null;
  }
}

/** 16 random bytes in lowercase base32: DNS-safe, case-insensitive, 26 characters. */
export function newLabel(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = randomBytes(17);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 26) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/** Builds and parses preview hostnames from `PREVIEW_URL_TEMPLATE`, e.g. `http://{session}.preview.localhost:4100`. */
export class PreviewUrls {
  private readonly suffix: string;

  constructor(private readonly template: string) {
    const host = new URL(template.replace("{session}", "placeholder")).hostname;
    if (!host.startsWith("placeholder.")) throw new Error("PREVIEW_URL_TEMPLATE must start its hostname with {session}.");
    this.suffix = host.slice("placeholder".length);
  }

  url(label: string): string {
    return this.template.replace("{session}", label);
  }

  /** The session label in a request's Host header, or null when the host is not a preview host. */
  labelFromHost(hostHeader: string | undefined): string | null {
    if (!hostHeader) return null;
    const host = hostHeader.toLowerCase().replace(/:\d+$/, "");
    if (!host.endsWith(this.suffix)) return null;
    const label = host.slice(0, -this.suffix.length);
    return LABEL.test(label) ? label : null;
  }
}
