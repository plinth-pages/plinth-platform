-- CreateEnum
CREATE TYPE "LegalRequestKind" AS ENUM ('access', 'correction', 'deletion', 'consent_withdrawal', 'grievance', 'other');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "terms_accepted_at" TIMESTAMP(3),
ADD COLUMN     "terms_version" TEXT;

-- CreateTable
CREATE TABLE "legal_requests" (
    "id" TEXT NOT NULL,
    "kind" "LegalRequestKind" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "user_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_requests_created_at_idx" ON "legal_requests"("created_at");

-- AddForeignKey
ALTER TABLE "legal_requests" ADD CONSTRAINT "legal_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
