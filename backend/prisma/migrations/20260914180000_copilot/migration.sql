-- CreateEnum
CREATE TYPE "CopilotRole" AS ENUM ('user', 'assistant');

-- AlterEnum
ALTER TYPE "OperationType" ADD VALUE 'copilot';

-- CreateTable
CREATE TABLE "copilot_messages" (
    "id" TEXT NOT NULL,
    "portfolio_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "CopilotRole" NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "operation_id" TEXT,
    "changes" JSONB,
    "refused" BOOLEAN NOT NULL DEFAULT false,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "copilot_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "copilot_messages_portfolio_id_created_at_idx" ON "copilot_messages"("portfolio_id", "created_at");

-- CreateIndex
CREATE INDEX "copilot_messages_user_id_created_at_idx" ON "copilot_messages"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

