-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "PortfolioStatus" AS ENUM ('provisioning', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "SandboxStatus" AS ENUM ('starting', 'running', 'paused', 'destroyed', 'unhealthy');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('edit', 'install', 'uninstall', 'move', 'theme', 'fleet_update', 'publish');

-- CreateEnum
CREATE TYPE "OperationActor" AS ENUM ('user', 'copilot', 'system');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('queued', 'staging', 'checking', 'applying', 'applied', 'rejected', 'reverted', 'failed');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('pending', 'building', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant', 'tool');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "github_id" TEXT NOT NULL,
    "github_login" TEXT NOT NULL,
    "name" TEXT,
    "avatar_url" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolios" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "slug" TEXT,
    "status" "PortfolioStatus" NOT NULL DEFAULT 'provisioning',
    "repo_name" TEXT,
    "repo_id" TEXT,
    "vercel_project_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sandboxes" (
    "id" TEXT NOT NULL,
    "portfolio_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'e2b',
    "external_id" TEXT,
    "status" "SandboxStatus" NOT NULL DEFAULT 'starting',
    "preview_url" TEXT,
    "last_accessed_at" TIMESTAMP(3),
    "minutes_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sandboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations" (
    "id" TEXT NOT NULL,
    "portfolio_id" TEXT NOT NULL,
    "type" "OperationType" NOT NULL,
    "actor" "OperationActor" NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'queued',
    "input" JSONB NOT NULL,
    "diff" TEXT,
    "check_output" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "commit_sha" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployments" (
    "id" TEXT NOT NULL,
    "portfolio_id" TEXT NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'pending',
    "commit_sha" TEXT NOT NULL,
    "vercel_deployment_id" TEXT,
    "url" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "package_name" TEXT NOT NULL,
    "latest_version" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installed_integrations" (
    "id" TEXT NOT NULL,
    "portfolio_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "props" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installed_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credentials" (
    "id" TEXT NOT NULL,
    "portfolio_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "portfolio_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_github_id_key" ON "users"("github_id");

-- CreateIndex
CREATE UNIQUE INDEX "portfolios_slug_key" ON "portfolios"("slug");

-- CreateIndex
CREATE INDEX "portfolios_user_id_idx" ON "portfolios"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sandboxes_portfolio_id_key" ON "sandboxes"("portfolio_id");

-- CreateIndex
CREATE INDEX "operations_portfolio_id_created_at_idx" ON "operations"("portfolio_id", "created_at");

-- CreateIndex
CREATE INDEX "deployments_portfolio_id_created_at_idx" ON "deployments"("portfolio_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "installed_integrations_portfolio_id_integration_id_key" ON "installed_integrations"("portfolio_id", "integration_id");

-- CreateIndex
CREATE UNIQUE INDEX "credentials_portfolio_id_key_key" ON "credentials"("portfolio_id", "key");

-- CreateIndex
CREATE INDEX "conversations_portfolio_id_idx" ON "conversations"("portfolio_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installed_integrations" ADD CONSTRAINT "installed_integrations_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installed_integrations" ADD CONSTRAINT "installed_integrations_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
