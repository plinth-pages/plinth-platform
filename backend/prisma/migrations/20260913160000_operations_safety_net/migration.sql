-- AlterTable
ALTER TABLE "operations" ADD COLUMN     "check_ms" INTEGER,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "revert_sha" TEXT,
ADD COLUMN     "summary" TEXT NOT NULL,
ADD COLUMN     "total_ms" INTEGER;

-- AlterTable
ALTER TABLE "sandboxes" ADD COLUMN     "pending_push" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "operations_portfolio_id_status_idx" ON "operations"("portfolio_id", "status");

