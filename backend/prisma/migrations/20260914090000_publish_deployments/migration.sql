-- AlterEnum
ALTER TYPE "DeploymentStatus" ADD VALUE 'unconfigured';

-- AlterTable
ALTER TABLE "deployments" ADD COLUMN     "operation_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "deployments_operation_id_key" ON "deployments"("operation_id");

