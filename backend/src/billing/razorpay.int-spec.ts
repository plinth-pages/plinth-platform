/** Razorpay checkout against real Postgres, with Razorpay's API faked. Run with `pnpm test:int`. */
import type { ConfigService } from "@nestjs/config";
import type { User } from "@prisma/client";
import { createHmac } from "crypto";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { PromoCodes } from "./promo-codes";
import { RazorpayService, razorpayPlanExpired } from "./razorpay.service";

process.loadEnvFile(".env");
jest.setTimeout(30_000);

const KEY_ID = "rzp_test_fake";
const KEY_SECRET = "fake-secret";
const PRICE = 120_000;
const YEAR_PRICE = 1_200_000;

const prisma = new PrismaService();
const createdUsers: string[] = [];
const createdCodes: string[] = [];

const config = {
  get: (key: string) =>
    ({ RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_PRO_PRICE_PAISE: PRICE, RAZORPAY_PRO_YEAR_PRICE_PAISE: YEAR_PRICE, RAZORPAY_CURRENCY: "INR" })[
      key
    ],
} as unknown as ConfigService<Env, true>;

const service = (fetchImpl?: typeof fetch, configOverride: ConfigService<Env, true> = config) => new RazorpayService(prisma, configOverride, new PromoCodes(prisma), fetchImpl);

/** Razorpay's orders endpoint: records what we sent and answers with an order id. */
function fakeRazorpay({ fail = false } = {}) {
  const orders: Record<string, unknown>[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    orders.push({ url, auth: (init.headers as Record<string, string>).Authorization, ...body });
    if (fail) return new Response(JSON.stringify({ error: { description: "Authentication failed" } }), { status: 401 });
    return new Response(JSON.stringify({ id: `order_${orders.length}${Date.now().toString(36)}`, amount: body.amount, currency: body.currency }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, orders };
}

const sign = (orderId: string, paymentId: string, secret = KEY_SECRET) => createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");

async function user(): Promise<User> {
  const row = await prisma.user.create({ data: { email: `rzp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`, githubLogin: `rzp-${Date.now()}` } });
  createdUsers.push(row.id);
  return row;
}

beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.paymentOrder.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.promoCode.deleteMany({ where: { code: { in: createdCodes } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

it("creates an order in paise and grants 30 days of Pro once the signature checks out", async () => {
  const { fetchImpl, orders } = fakeRazorpay();
  const razorpay = service(fetchImpl);
  const buyer = await user();

  const order = await razorpay.createOrder(buyer);
  expect(order).toMatchObject({ amount: PRICE, currency: "INR", keyId: KEY_ID, days: 30, passId: "monthly", promo: null });
  expect(orders[0]).toMatchObject({ url: "https://api.razorpay.com/v1/orders", amount: PRICE, currency: "INR", notes: { userId: buyer.id, plan: "pro" } });
  expect(String(orders[0].receipt).length).toBeLessThanOrEqual(40);
  // The key secret is sent to Razorpay as basic auth, and nowhere else.
  expect(String(orders[0].auth)).toBe(`Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`);
  expect(order).not.toHaveProperty("keySecret");

  const paymentId = "pay_success1";
  const result = await razorpay.verify(buyer, { razorpay_order_id: order.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(order.orderId, paymentId) });
  expect(result).toMatchObject({ plan: "pro", alreadyApplied: false });
  expect(Date.parse(result.renewsAt!) - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60_000);

  const paid = await prisma.user.findUnique({ where: { id: buyer.id } });
  expect(paid).toMatchObject({ plan: "pro", paymentProvider: "razorpay", planCancelsAtPeriodEnd: true });
  expect(await prisma.paymentOrder.findUnique({ where: { providerOrderId: order.orderId } })).toMatchObject({ status: "paid", providerPaymentId: paymentId });

  // Sending the same payment again must not extend the plan a second time.
  const replay = await razorpay.verify(paid!, { razorpay_order_id: order.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(order.orderId, paymentId) });
  expect(replay.alreadyApplied).toBe(true);
  expect(replay.renewsAt).toBe(paid!.planRenewsAt!.toISOString());
});

it("refuses a forged signature, an unknown order, and someone else's order — and never grants Pro", async () => {
  const { fetchImpl } = fakeRazorpay();
  const razorpay = service(fetchImpl);
  const buyer = await user();
  const stranger = await user();
  const order = await razorpay.createOrder(buyer);

  await expect(razorpay.verify(buyer, { razorpay_order_id: order.orderId, razorpay_payment_id: "pay_x", razorpay_signature: sign(order.orderId, "pay_x", "wrong-secret") })).rejects.toMatchObject({
    response: { code: "SIGNATURE_MISMATCH" },
  });
  await expect(razorpay.verify(buyer, { razorpay_order_id: "order_nope", razorpay_payment_id: "pay_x", razorpay_signature: "a".repeat(64) })).rejects.toMatchObject({ response: { code: "ORDER_UNKNOWN" } });
  await expect(razorpay.verify(stranger, { razorpay_order_id: order.orderId, razorpay_payment_id: "pay_y", razorpay_signature: sign(order.orderId, "pay_y") })).rejects.toMatchObject({
    response: { code: "ORDER_UNKNOWN" },
  });
  await expect(razorpay.verify(buyer, { razorpay_order_id: order.orderId })).rejects.toMatchObject({ response: { code: "PAYMENT_INCOMPLETE" } });

  expect(await prisma.user.findUnique({ where: { id: buyer.id } })).toMatchObject({ plan: "free", paymentProvider: null });
});

it("takes a promo code off the amount, and reports a bad key or missing setup clearly", async () => {
  const { fetchImpl, orders } = fakeRazorpay();
  const razorpay = service(fetchImpl);
  const buyer = await user();
  const code = `RZP${Date.now().toString().slice(-6)}`;
  createdCodes.push(code);
  await prisma.promoCode.create({ data: { code, percentOff: 25, duration: "once", stripeCouponId: "co_x", stripePromotionCodeId: `promo_${code}` } });

  const order = await razorpay.createOrder(buyer, { promoCode: code.toLowerCase() });
  expect(order).toMatchObject({ amount: PRICE * 0.75, promo: { code, percentOff: 25 } });
  expect(orders[0]).toMatchObject({ notes: { promoCode: code } });
  await expect(razorpay.createOrder(buyer, { promoCode: "NOSUCHCODE" })).rejects.toMatchObject({ response: { code: "PROMO_INVALID" } });

  const refused = service(fakeRazorpay({ fail: true }).fetchImpl);
  await expect(refused.createOrder(buyer)).rejects.toThrow(/aren't set up correctly/);

  const unset = service(undefined, { get: () => undefined } as unknown as ConfigService<Env, true>);
  expect(unset.configured).toBe(false);
  await expect(unset.createOrder(buyer)).rejects.toThrow(/aren't set up on this server/);
});

it("sells a year as one payment, and refuses a pass that isn't on offer", async () => {
  const { fetchImpl, orders } = fakeRazorpay();
  const razorpay = service(fetchImpl);
  const buyer = await user();

  expect(razorpay.passes).toMatchObject([
    { id: "monthly", days: 30, amount: PRICE, currency: "INR", months: 1, savingsPercent: null, recommended: false },
    { id: "yearly", days: 365, amount: YEAR_PRICE, currency: "INR", months: 12, savingsPercent: 18, recommended: true },
  ]);

  const order = await razorpay.createOrder(buyer, { passId: "yearly" });
  expect(order).toMatchObject({ amount: YEAR_PRICE, currency: "INR", days: 365, passId: "yearly", passLabel: "12 months" });
  expect(orders[0]).toMatchObject({ amount: YEAR_PRICE, notes: { pass: "yearly", days: "365" } });

  const paymentId = "pay_year1";
  const result = await razorpay.verify(buyer, { razorpay_order_id: order.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(order.orderId, paymentId) });
  expect(Date.parse(result.renewsAt!) - Date.now()).toBeGreaterThan(364 * 24 * 60 * 60_000);

  await expect(razorpay.createOrder(buyer, { passId: "decade" })).rejects.toMatchObject({ response: { code: "PASS_UNKNOWN" } });
});

it("treats a lapsed paid month as Free", () => {
  const day = 24 * 60 * 60_000;
  expect(razorpayPlanExpired({ plan: "pro", paymentProvider: "razorpay", planRenewsAt: new Date(Date.now() - day) })).toBe(true);
  expect(razorpayPlanExpired({ plan: "pro", paymentProvider: "razorpay", planRenewsAt: new Date(Date.now() + day) })).toBe(false);
  // A Stripe subscription past its date is Stripe's business: its webhooks decide.
  expect(razorpayPlanExpired({ plan: "pro", paymentProvider: "stripe", planRenewsAt: new Date(Date.now() - day) })).toBe(false);
  expect(razorpayPlanExpired({ plan: "free", paymentProvider: null, planRenewsAt: null })).toBe(false);
});
