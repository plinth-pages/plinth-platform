/** Billing webhooks and plan limits against real Postgres, with Stripe's signature scheme but no network. */
import type { ConfigService } from "@nestjs/config";
import type { User } from "@prisma/client";
import Stripe from "stripe";
import { AiService } from "../ai/ai.service";
import type { Env } from "../config/env";
import { CopilotService } from "../copilot/copilot.service";
import { PrismaService } from "../prisma/prisma.service";
import { BillingService } from "./billing.service";
import { PLANS } from "./plans";

process.loadEnvFile(".env");
jest.setTimeout(30_000);

const prisma = new PrismaService();
const SECRET = "whsec_test_secret";
const values: Record<string, unknown> = { STRIPE_WEBHOOK_SECRET: SECRET, ADMIN_URL: "http://localhost:3000" };
const config = { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
const createdUsers: string[] = [];

const signing = new Stripe("sk_test_offline");
let subscriptions: Record<string, Partial<Stripe.Subscription>>;
const stripe = Object.assign(signing, {
  subscriptions: { retrieve: async (id: string) => subscriptions[id] },
}) as unknown as Stripe;
const billing = () => new BillingService(prisma, config, stripe);

async function user(): Promise<User> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const created = await prisma.user.create({ data: { githubLogin: `bill-${suffix}`, email: `bill-${suffix}@example.com` } });
  createdUsers.push(created.id);
  return created;
}

function deliver(event: { id: string; type: string; data: { object: unknown } }, secret = SECRET) {
  const payload = JSON.stringify({ object: "event", api_version: "2025-01-01", created: Math.floor(Date.now() / 1000), ...event });
  const header = signing.webhooks.generateTestHeaderString({ payload, secret });
  return billing().handleWebhook(Buffer.from(payload), header);
}

const subscription = (id: string, userId: string, status: string, extra: object = {}) => ({
  id,
  object: "subscription",
  status,
  customer: `cus_${userId.slice(-8)}`,
  metadata: { userId },
  cancel_at_period_end: false,
  items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400 }] },
  ...extra,
});

beforeAll(() => prisma.$connect());
beforeEach(() => {
  subscriptions = {};
});
afterAll(async () => {
  await prisma.billingEvent.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("webhooks", () => {
  it("upgrades on checkout completion, once, from a correctly signed event only", async () => {
    const asha = await user();
    subscriptions.sub_1 = subscription("sub_1", asha.id, "active") as never;
    const event = { id: `evt_${Date.now()}_1`, type: "checkout.session.completed", data: { object: { object: "checkout.session", client_reference_id: asha.id, subscription: "sub_1", metadata: {} } } };

    await expect(deliver(event, "whsec_wrong")).rejects.toThrow("Invalid webhook signature.");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: asha.id } })).plan).toBe("free");

    expect(await deliver(event)).toBe(true);
    const upgraded = await prisma.user.findUniqueOrThrow({ where: { id: asha.id } });
    expect(upgraded).toMatchObject({ plan: "pro", stripeSubscriptionId: "sub_1", subscriptionStatus: "active", planCancelsAtPeriodEnd: false });
    expect(upgraded.planRenewsAt!.getTime()).toBeGreaterThan(Date.now());

    expect(await deliver(event)).toBe(false); // Stripe retried: applied once
  });

  it("keeps Pro while a payment is retried, notes a scheduled cancellation, and downgrades when the subscription ends", async () => {
    const ravi = await user();
    const send = (status: string, extra: object = {}) =>
      deliver({ id: `evt_${Date.now()}_${Math.random()}`, type: status === "canceled" ? "customer.subscription.deleted" : "customer.subscription.updated", data: { object: subscription("sub_2", ravi.id, status, extra) } });

    await send("active");
    await send("past_due");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ravi.id } })).plan).toBe("pro");
    await send("active", { cancel_at_period_end: true });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: ravi.id } })).toMatchObject({ plan: "pro", planCancelsAtPeriodEnd: true });
    await send("canceled");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ravi.id } })).plan).toBe("free");
  });

  it("an old subscription ending doesn't downgrade someone on a newer one", async () => {
    const meera = await user();
    await deliver({ id: `evt_${Date.now()}_n`, type: "customer.subscription.created", data: { object: subscription("sub_new", meera.id, "active") } });
    await deliver({ id: `evt_${Date.now()}_o`, type: "customer.subscription.deleted", data: { object: subscription("sub_old", meera.id, "canceled") } });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: meera.id } })).toMatchObject({ plan: "pro", stripeSubscriptionId: "sub_new" });
  });

  it("reports billing as unavailable without Stripe", async () => {
    const bare = new BillingService(prisma, config, null);
    expect(bare.status(await user())).toMatchObject({ plan: "free", checkoutAvailable: false, priceUsd: 15 });
    expect(billing().status(await user()).checkoutAvailable).toBe(true);
    await expect(bare.checkout(await user())).rejects.toThrow(/isn't set up/);
  });
});

describe("plan limits in the co-pilot", () => {
  const ai = new AiService({ get: () => undefined } as never, [
    { id: "groq", configured: () => true, generate: async () => Promise.reject(new Error("unused")) },
    { id: "anthropic", configured: () => true, generate: async () => Promise.reject(new Error("unused")) },
  ]);
  const operations = { enqueue: async () => ({ id: "op", status: "queued" }) };
  const service = new CopilotService(prisma, operations as never, ai, config);

  async function portfolioFor(owner: User) {
    return prisma.portfolio.create({ data: { userId: owner.id, role: "developer", status: "ready", repoName: `portfolio-${owner.githubLogin}` } });
  }

  it("locks Claude on Free and unlocks it on Pro", async () => {
    const free = await user();
    const portfolio = await portfolioFor(free);
    expect(service.models(free).models.find((m) => m.id === "claude-3-5-sonnet")).toMatchObject({ locked: true, available: false });
    await expect(service.send(free, portfolio.id, { message: "hi", model: "claude-3-5-sonnet" })).rejects.toMatchObject({ response: { code: "PREMIUM_REQUIRED" } });

    const pro = await prisma.user.update({ where: { id: free.id }, data: { plan: "pro" } });
    expect(service.models(pro).models.find((m) => m.id === "claude-3-5-sonnet")).toMatchObject({ locked: false, available: true });
    await expect(service.send(pro, portfolio.id, { message: "hi", model: "claude-3-5-sonnet" })).resolves.toBeDefined();
  });

  it("blocks the co-pilot once the monthly token allowance is used, and Pro raises it", async () => {
    const free = await user();
    const portfolio = await portfolioFor(free);
    await prisma.copilotMessage.create({
      data: { portfolioId: portfolio.id, userId: free.id, role: "assistant", content: "done", inputTokens: PLANS.free.limits.monthlyTokens, outputTokens: 1 },
    });
    const listed = await service.list(free, portfolio.id);
    expect(listed.usage).toMatchObject({ plan: "free", tokensUsed: PLANS.free.limits.monthlyTokens + 1, tokenLimit: PLANS.free.limits.monthlyTokens });
    await expect(service.send(free, portfolio.id, { message: "hi" })).rejects.toMatchObject({ response: { code: "TOKEN_LIMIT", message: expect.stringContaining("Upgrade to Pro") } });

    const pro = await prisma.user.update({ where: { id: free.id }, data: { plan: "pro" } });
    await expect(service.send(pro, portfolio.id, { message: "hi" })).resolves.toBeDefined();
  });

  it("blocks after the daily message limit on Free", async () => {
    const free = await user();
    const portfolio = await portfolioFor(free);
    await prisma.copilotMessage.createMany({
      data: Array.from({ length: PLANS.free.limits.dailyMessages }, () => ({ portfolioId: portfolio.id, userId: free.id, role: "user" as const, content: "x" })),
    });
    await expect(service.send(free, portfolio.id, { message: "hi" })).rejects.toMatchObject({ response: { code: "DAILY_LIMIT" } });
  });
});
