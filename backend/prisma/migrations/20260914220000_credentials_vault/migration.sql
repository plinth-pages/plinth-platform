-- AlterTable
ALTER TABLE "credentials" ADD COLUMN     "hint" TEXT NOT NULL,
ADD COLUMN     "integration_id" TEXT NOT NULL,
ADD COLUMN     "synced_at" TIMESTAMP(3),
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "verified_at" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "visitor_counts" (
    "portfolio_id" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visitor_counts_pkey" PRIMARY KEY ("portfolio_id")
);

-- AddForeignKey
ALTER TABLE "visitor_counts" ADD CONSTRAINT "visitor_counts_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

