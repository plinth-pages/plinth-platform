-- AlterTable
ALTER TABLE "users" ADD COLUMN     "suspended_at" TIMESTAMP(3),
ADD COLUMN     "suspended_reason" TEXT;
