/** Promo codes against real Postgres, with an in-memory Stripe. Run with `pnpm test:int`. */
import type { User } from "@prisma/client";
import type Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { PromoCodes } from "./promo-codes";

process.loadEnvFile(".env");
jest.setTimeout(30_000);

const prisma = new PrismaService();
let admin: User;
const created: string[] = [];

/** Just enough of Stripe's coupons and promotion codes. */
function fakeStripe() {
  const coupons = new Map<string, Partial<Stripe.Coupon>>();
  const promotions = new Map<string, Stripe.PromotionCode>();
  const run = Math.random().toString(36).slice(2, 8);
  let n = 0;
  const stripe = {
    coupons: {
      create: async (params: Stripe.CouponCreateParams) => {
        const coupon = { id: `co_${run}_${++n}`, percent_off: params.percent_off ?? null, duration: params.duration, duration_in_months: params.duration_in_months ?? null };
        coupons.set(coupon.id, coupon as Partial<Stripe.Coupon>);
        return coupon;
      },
      retrieve: async (id: string) => coupons.get(id),
      del: async (id: string) => coupons.delete(id),
    },
    promotionCodes: {
      create: async (params: Stripe.PromotionCodeCreateParams) => {
        if ([...promotions.values()].some((p) => p.code === params.code)) throw new Error("code already exists");
        const promotion = {
          id: `promo_${run}_${++n}`,
          code: params.code,
          active: true,
          expires_at: params.expires_at ?? null,
          max_redemptions: params.max_redemptions ?? null,
          times_redeemed: 0,
          promotion: { type: "coupon", coupon: params.promotion.coupon },
        } as unknown as Stripe.PromotionCode;
        promotions.set(promotion.id, promotion);
        return promotion;
      },
      list: (params: { code?: string }) => {
        const data = [...promotions.values()].filter((p) => !params.code || p.code === params.code);
        const page = Promise.resolve({ data }) as Promise<{ data: Stripe.PromotionCode[] }> & AsyncIterable<Stripe.PromotionCode>;
        page[Symbol.asyncIterator] = async function* () {
          yield* data;
        };
        return page;
      },
      update: async (id: string, params: { active?: boolean }) => Object.assign(promotions.get(id)!, params),
    },
  };
  return { stripe: stripe as unknown as Stripe, promotions };
}

beforeAll(async () => {
  await prisma.$connect();
  admin = await prisma.user.create({ data: { email: `promo-admin-${Date.now()}@example.com`, githubLogin: "promo-admin", role: "admin" } });
});
afterAll(async () => {
  await prisma.promoCode.deleteMany({ where: { code: { in: created } } });
  await prisma.user.delete({ where: { id: admin.id } });
  await prisma.$disconnect();
});

it("issues a one-day code, previews it, and refuses it once used up or switched off", async () => {
  const { stripe, promotions } = fakeStripe();
  const promos = new PromoCodes(prisma, stripe);
  const code = `LAUNCH${Date.now().toString().slice(-6)}`;
  created.push(code);

  const issued = await promos.create(admin, { code: code.toLowerCase(), percentOff: 30, duration: "repeating", durationMonths: 3, validForHours: 24, maxRedemptions: 2, note: "Launch tweet" });
  expect(issued).toMatchObject({ code, percentOff: 30, duration: "repeating", durationMonths: 3, maxRedemptions: 2, status: "active", timesRedeemed: 0 });
  expect(Date.parse(issued.expiresAt!) - Date.now()).toBeGreaterThan(23 * 60 * 60_000);

  await expect(promos.preview(` ${code.toLowerCase()} `)).resolves.toMatchObject({ code, percentOff: 30, duration: "repeating", durationMonths: 3 });
  const promotionId = await promos.promotionIdFor(code);

  promotions.get(promotionId)!.times_redeemed = 2;
  await expect(promos.preview(code)).rejects.toMatchObject({ response: { code: "PROMO_EXPIRED", message: expect.stringContaining("fully used") } });
  expect((await promos.list()).find((c) => c.code === code)).toMatchObject({ status: "used_up", timesRedeemed: 2 });

  promotions.get(promotionId)!.times_redeemed = 0;
  await promos.deactivate(issued.id);
  await expect(promos.preview(code)).rejects.toMatchObject({ response: { code: "PROMO_EXPIRED" } });
  expect((await promos.list()).find((c) => c.code === code)?.status).toBe("inactive");
});

it("generates a code when none is given, and rejects bad input and duplicates", async () => {
  const { stripe } = fakeStripe();
  const promos = new PromoCodes(prisma, stripe);

  const generated = await promos.create(admin, { percentOff: 15, duration: "once" });
  created.push(generated.code);
  expect(generated.code).toMatch(/^PLINTH15-[A-Z2-9]{6}$/);
  expect(generated.expiresAt).toBeNull();

  await expect(promos.create(admin, { percentOff: 0, duration: "once" })).rejects.toMatchObject({ response: { fields: { percentOff: expect.any(String) } } });
  await expect(promos.create(admin, { percentOff: 10, duration: "repeating" })).rejects.toMatchObject({ response: { fields: { durationMonths: expect.any(String) } } });
  await expect(promos.create(admin, { code: "no spaces allowed", percentOff: 10, duration: "once" })).rejects.toMatchObject({ response: { fields: { code: expect.any(String) } } });
  await expect(promos.create(admin, { code: generated.code, percentOff: 10, duration: "once" })).rejects.toMatchObject({ response: { fields: { code: "That code already exists." } } });
  await expect(promos.preview("NOPE-NOT-REAL")).rejects.toMatchObject({ response: { code: "PROMO_INVALID" } });
});
