-- CreateEnum
CREATE TYPE "ProductionBatchStatus" AS ENUM ('DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InventoryMovementType" ADD VALUE 'PRODUCTION_CONSUME';
ALTER TYPE "InventoryMovementType" ADD VALUE 'PRODUCTION_OUTPUT';
ALTER TYPE "InventoryMovementType" ADD VALUE 'PRODUCTION_WASTE';

-- CreateTable
CREATE TABLE "ProductionRecipe" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "finishedProductId" TEXT NOT NULL,
    "expectedQuantity" DOUBLE PRECISION NOT NULL,
    "expectedUnit" TEXT NOT NULL,
    "targetMarginPct" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "ProductionRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRecipeInput" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "inputProductId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "ProductionRecipeInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionBatch" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" "ProductionBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "plannedQuantity" DOUBLE PRECISION NOT NULL,
    "producedGoodQuantity" DOUBLE PRECISION,
    "producedBadQuantity" DOUBLE PRECISION,
    "materialsCost" DOUBLE PRECISION,
    "laborCost" DOUBLE PRECISION,
    "overheadCost" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION,
    "unitCost" DOUBLE PRECISION,
    "suggestedPrice" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "ProductionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionBatchInput" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "inputProductId" TEXT NOT NULL,
    "plannedQuantity" DOUBLE PRECISION NOT NULL,
    "actualQuantity" DOUBLE PRECISION,
    "unit" TEXT NOT NULL,
    "unitCost" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION,

    CONSTRAINT "ProductionBatchInput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRecipe_code_key" ON "ProductionRecipe"("code");

-- CreateIndex
CREATE INDEX "ProductionRecipe_finishedProductId_idx" ON "ProductionRecipe"("finishedProductId");

-- CreateIndex
CREATE INDEX "ProductionRecipe_code_idx" ON "ProductionRecipe"("code");

-- CreateIndex
CREATE INDEX "ProductionRecipe_isActive_idx" ON "ProductionRecipe"("isActive");

-- CreateIndex
CREATE INDEX "ProductionRecipeInput_recipeId_idx" ON "ProductionRecipeInput"("recipeId");

-- CreateIndex
CREATE INDEX "ProductionRecipeInput_inputProductId_idx" ON "ProductionRecipeInput"("inputProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatch_batchNumber_key" ON "ProductionBatch"("batchNumber");

-- CreateIndex
CREATE INDEX "ProductionBatch_recipeId_idx" ON "ProductionBatch"("recipeId");

-- CreateIndex
CREATE INDEX "ProductionBatch_branchId_idx" ON "ProductionBatch"("branchId");

-- CreateIndex
CREATE INDEX "ProductionBatch_status_idx" ON "ProductionBatch"("status");

-- CreateIndex
CREATE INDEX "ProductionBatch_batchNumber_idx" ON "ProductionBatch"("batchNumber");

-- CreateIndex
CREATE INDEX "ProductionBatchInput_batchId_idx" ON "ProductionBatchInput"("batchId");

-- CreateIndex
CREATE INDEX "ProductionBatchInput_inputProductId_idx" ON "ProductionBatchInput"("inputProductId");

-- AddForeignKey
ALTER TABLE "ProductionRecipe" ADD CONSTRAINT "ProductionRecipe_finishedProductId_fkey" FOREIGN KEY ("finishedProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRecipe" ADD CONSTRAINT "ProductionRecipe_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRecipeInput" ADD CONSTRAINT "ProductionRecipeInput_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "ProductionRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRecipeInput" ADD CONSTRAINT "ProductionRecipeInput_inputProductId_fkey" FOREIGN KEY ("inputProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "ProductionRecipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatchInput" ADD CONSTRAINT "ProductionBatchInput_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatchInput" ADD CONSTRAINT "ProductionBatchInput_inputProductId_fkey" FOREIGN KEY ("inputProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
