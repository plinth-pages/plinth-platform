-- Promo codes are enforced by Plinth itself; Stripe is now an optional mirror.
ALTER TABLE "promo_codes" ALTER COLUMN "stripe_coupon_id" DROP NOT NULL;
ALTER TABLE "promo_codes" ALTER COLUMN "stripe_promotion_code_id" DROP NOT NULL;
