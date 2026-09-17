-- CreateEnum
CREATE TYPE "PromoDuration" AS ENUM ('once', 'repeating', 'forever');

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "percent_off" INTEGER NOT NULL,
    "duration" "PromoDuration" NOT NULL,
    "duration_months" INTEGER,
    "expires_at" TIMESTAMP(3),
    "max_redemptions" INTEGER,
    "note" TEXT,
    "stripe_coupon_id" TEXT NOT NULL,
    "stripe_promotion_code_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_stripe_promotion_code_id_key" ON "promo_codes"("stripe_promotion_code_id");

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
