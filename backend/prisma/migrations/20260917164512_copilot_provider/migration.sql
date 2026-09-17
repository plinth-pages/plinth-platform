-- AlterTable
ALTER TABLE "copilot_messages" ADD COLUMN     "fell_back" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "provider" TEXT;
