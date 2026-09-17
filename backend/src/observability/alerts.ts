import { Global, Inject, Injectable, Logger, Module, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";

/** Lets tests capture posts instead of calling Slack. */
export const ALERT_FETCH = Symbol("ALERT_FETCH");

export interface Alert {
  /** One line naming what broke, e.g. "Plinth AI call failed". */
  title: string;
  error?: unknown;
  /** Extra lines shown as `key: value`. Null and undefined values are dropped. */
  fields?: Record<string, string | number | null | undefined>;
  /** Alerts sharing a key are sent at most once per window, so one broken provider can't flood the channel. */
  dedupeKey?: string;
  level?: "error" | "warning";
}

const DEDUPE_MS = 10 * 60_000;
const MAX_PER_HOUR = 30;
const POST_TIMEOUT_MS = 5_000;
const MAX_ERROR_CHARS = 600;

/**
 * Sends critical failures to Slack (`SLACK_WEBHOOK_URL`), so a provider running out of credit or a worker crashing is
 * visible without reading logs. Alerting must never affect the request that failed: every send is fire-and-forget,
 * capped per hour, and silent when the webhook isn't configured.
 */
@Injectable()
export class Alerts {
  private readonly logger = new Logger(Alerts.name);
  private readonly fetchImpl: typeof fetch;
  private readonly lastSent = new Map<string, number>();
  private hourStartedAt = Date.now();
  private sentThisHour = 0;

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Optional() @Inject(ALERT_FETCH) fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.config.get("SLACK_WEBHOOK_URL", { infer: true }));
  }

  /** Never throws and never waits: call it and carry on. */
  send(alert: Alert): void {
    void this.post(alert).catch(() => undefined);
  }

  private async post(alert: Alert): Promise<void> {
    const webhook = this.config.get("SLACK_WEBHOOK_URL", { infer: true });
    if (!webhook || !this.allowed(alert)) return;

    const message = describe(alert.error);
    const fields = { ...alert.fields, when: new Date().toISOString(), environment: this.config.get("NODE_ENV", { infer: true }) };
    const lines = Object.entries(fields)
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .map(([key, value]) => `• *${key}:* ${String(value)}`);

    const emoji = alert.level === "warning" ? "⚠️" : "🚨";
    const blocks = [
      { type: "section", text: { type: "mrkdwn", text: `${emoji} *${alert.title}*` } },
      ...(message ? [{ type: "section", text: { type: "mrkdwn", text: "```" + message.slice(0, MAX_ERROR_CHARS) + "```" } }] : []),
      ...(lines.length ? [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }] : []),
    ];

    try {
      const response = await this.fetchImpl(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `text` is the notification preview; blocks are the message body.
        body: JSON.stringify({ text: `${emoji} ${alert.title}${message ? `: ${message.slice(0, 140)}` : ""}`, blocks }),
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      });
      if (!response.ok) this.logger.warn(`Slack refused the alert (${response.status})`);
    } catch (error) {
      this.logger.warn(`Couldn't reach Slack: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** One alert per key per window, and a ceiling per hour whatever the keys. */
  private allowed(alert: Alert): boolean {
    const now = Date.now();
    if (now - this.hourStartedAt > 60 * 60_000) {
      this.hourStartedAt = now;
      this.sentThisHour = 0;
    }
    if (this.sentThisHour >= MAX_PER_HOUR) return false;

    const key = alert.dedupeKey ?? alert.title;
    const last = this.lastSent.get(key) ?? 0;
    if (now - last < DEDUPE_MS) return false;
    if (this.lastSent.size > 500) this.lastSent.clear();
    this.lastSent.set(key, now);
    this.sentThisHour += 1;
    return true;
  }
}

export function describe(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Available everywhere without each module importing it; alerts are cross-cutting. */
@Global()
@Module({ providers: [Alerts], exports: [Alerts] })
export class AlertsModule {}
