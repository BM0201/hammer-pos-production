-- Reposición v2: fusión de los dos motores de reposición en uno solo.
-- Todo aditivo — ningún campo ni tabla existente se modifica de forma destructiva.
-- StockReorderPolicy se reutiliza como la tabla de "override manual" (su sola
-- existencia activa para un (branch,producto) ya significa modo override);
-- BranchProductSetting gana un campo para "excluido" del motor.

-- AlterTable
ALTER TABLE "BranchProductSetting"
  ADD COLUMN "replenishmentExcluded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StockReorderPolicy"
  ADD COLUMN "preferredSupplierId" TEXT;

-- AlterTable
ALTER TABLE "ReplenishmentDraftItem"
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "estimatedUnitCost" DECIMAL(65,30),
  ADD COLUMN "addedManually" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ReplenishmentSignalSnapshot" (
    "branchId" TEXT NOT NULL,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "lowCount" INTEGER NOT NULL DEFAULT 0,
    "coveredCount" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplenishmentSignalSnapshot_pkey" PRIMARY KEY ("branchId")
);

-- AddForeignKey
ALTER TABLE "StockReorderPolicy" ADD CONSTRAINT "StockReorderPolicy_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentDraftItem" ADD CONSTRAINT "ReplenishmentDraftItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentSignalSnapshot" ADD CONSTRAINT "ReplenishmentSignalSnapshot_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
