-- AlterTable
ALTER TABLE "sandboxes" DROP COLUMN "minutes_used",
ADD COLUMN     "cold_start_ms" INTEGER,
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "paused_at" TIMESTAMP(3),
ADD COLUMN     "resume_ms" INTEGER,
ADD COLUMN     "run_started_at" TIMESTAMP(3),
ADD COLUMN     "seconds_used" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "status" SET DEFAULT 'destroyed';

-- CreateIndex
CREATE INDEX "sandboxes_status_updated_at_idx" ON "sandboxes"("status", "updated_at");

