-- CreateTable
CREATE TABLE "integration_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "portfolio_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_requests_key_idx" ON "integration_requests"("key");

-- CreateIndex
CREATE UNIQUE INDEX "integration_requests_user_id_key_key" ON "integration_requests"("user_id", "key");

-- AddForeignKey
ALTER TABLE "integration_requests" ADD CONSTRAINT "integration_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

