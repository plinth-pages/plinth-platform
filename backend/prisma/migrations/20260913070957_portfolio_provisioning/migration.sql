-- CreateEnum
CREATE TYPE "PortfolioRole" AS ENUM ('developer', 'designer', 'student', 'creator', 'freelancer', 'founder', 'researcher', 'other');

-- AlterTable
ALTER TABLE "portfolios" ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "provision_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "role" "PortfolioRole" NOT NULL,
ALTER COLUMN "repo_name" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "portfolios_repo_name_key" ON "portfolios"("repo_name");

-- CreateIndex
CREATE INDEX "portfolios_status_updated_at_idx" ON "portfolios"("status", "updated_at");

