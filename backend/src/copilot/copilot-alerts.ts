import { createHash } from "crypto";
import type { Alert, Alerts } from "../observability/alerts";

/**
 * Slack alerts for the times Plinth AI lets a user down: a refusal, an answer we couldn't use, an edit that wouldn't
 * apply, a change the safety net threw away. None of these is an exception, so nothing else reports them — and they
 * are the only record of what people actually asked for and didn't get. They are product signal, not outages, so
 * they go out as warnings.
 */

/** Enough of the request to recognise what was wanted, without pasting someone's whole résumé into Slack. */
const REQUEST_CHARS = 300;
const REPLY_CHARS = 300;

export interface LetdownContext {
  /** What the user typed. The reason this alert exists. */
  request: string;
  /** What we said back, when we said anything. */
  reply?: string;
  model: string;
  provider?: string;
  userId: string;
  portfolioId: string;
  operationId: string;
}

export function clip(text: string, limit: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > limit ? `${single.slice(0, limit)}…` : single;
}

/**
 * Distinct asks stay distinct, the same ask retried in a loop collapses. Alerts dedupe by key for ten minutes, so a
 * key of just "refused" would hide nine different refusals behind the first one.
 */
export function requestKey(request: string): string {
  return createHash("sha256").update(clip(request, REQUEST_CHARS).toLowerCase()).digest("hex").slice(0, 8);
}

export function letdown(reason: string, title: string, context: LetdownContext, extra: Alert["fields"] = {}): Alert {
  return {
    title,
    level: "warning",
    dedupeKey: `copilot:${reason}:${requestKey(context.request)}`,
    fields: {
      request: clip(context.request, REQUEST_CHARS),
      reply: context.reply ? clip(context.reply, REPLY_CHARS) : null,
      model: context.model,
      provider: context.provider ?? null,
      user: context.userId,
      portfolio: context.portfolioId,
      operation: context.operationId,
      ...extra,
    },
  };
}

/** Never let reporting a let-down cause one: `Alerts.send` is already fire-and-forget, and the planner may not have it. */
export function reportLetdown(alerts: Alerts | undefined, reason: string, title: string, context: LetdownContext, extra: Alert["fields"] = {}): void {
  alerts?.send(letdown(reason, title, context, extra));
}
