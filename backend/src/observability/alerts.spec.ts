import type { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { Alerts } from "./alerts";

const WEBHOOK = "https://hooks.slack.com/services/T000/B000/xxx";

function setup({ webhook = WEBHOOK, fetchImpl }: { webhook?: string; fetchImpl?: typeof fetch } = {}) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const config = { get: (key: string) => ({ SLACK_WEBHOOK_URL: webhook, NODE_ENV: "production" })[key] } as unknown as ConfigService<Env, true>;
  const impl = (fetchImpl ??
    (async (url: string, init: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("ok", { status: 200 });
    })) as unknown as typeof fetch;
  return { alerts: new Alerts(config, impl), posts };
}

/** `send` is fire-and-forget; let its promise settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Alerts", () => {
  it("posts the error, the fields and the time to Slack", async () => {
    const { alerts, posts } = setup();
    alerts.send({ title: "Plinth AI couldn't answer a request", error: new Error("402 out of credit"), fields: { provider: "openrouter", user: "user_1", model: null } });
    await flush();

    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(WEBHOOK);
    const text = JSON.stringify(posts[0].body);
    expect(posts[0].body.text).toContain("Plinth AI couldn't answer a request");
    expect(text).toContain("402 out of credit");
    expect(text).toContain("provider:* openrouter");
    expect(text).toContain("user:* user_1");
    expect(text).toContain("environment:* production");
    expect(text).toMatch(/when:\* \d{4}-\d{2}-\d{2}T/);
    // Empty values are left out rather than shown as "null".
    expect(text).not.toContain("model:");
  });

  it("sends one alert per problem, not one per occurrence", async () => {
    const { alerts, posts } = setup();
    for (let i = 0; i < 5; i++) alerts.send({ title: "AI provider out of credit", dedupeKey: "ai:openrouter:402", error: new Error("402") });
    alerts.send({ title: "Queue worker error: sandbox", dedupeKey: "worker:sandbox", error: new Error("ECONNRESET") });
    await flush();

    expect(posts).toHaveLength(2);
  });

  it("stays quiet without a webhook, and never throws when Slack is unreachable", async () => {
    const quiet = setup({ webhook: "" });
    quiet.alerts.send({ title: "ignored" });
    await flush();
    expect(quiet.posts).toHaveLength(0);
    expect(quiet.alerts.configured).toBe(false);

    const broken = setup({
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    });
    expect(() => broken.alerts.send({ title: "Uncaught exception in the worker", error: new Error("boom") })).not.toThrow();
    await flush();
  });
});
