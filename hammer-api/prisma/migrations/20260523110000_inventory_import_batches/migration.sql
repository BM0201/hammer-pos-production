CREATE TABLE "InventoryImportBatch" (
  "id" TEXT NOT NULL,
  "importType" TEXT NOT NULL,
  "destinationMode" TEXT NOT NULL,
  "defaultBranchId" TEXT,
  "fileHash" TEXT NOT NULL,
  "summaryJson" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREVIEW',
  "createdByUserId" TEXT NOT NULL,
  "executedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executedAt" TIMESTAMP(3),
  "createMissingProducts" BOOLEAN NOT NULL DEFAULT false,
  "defaultCategoryId" TEXT,
  "defaultUnit" TEXT,
  "defaultStandardSalePrice" DECIMAL(65,30),
  "resultJson" JSONB,
  CONSTRAINT "InventoryImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryImportLine" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "categoryCode" TEXT,
  "unit" TEXT,
  "action" TEXT NOT NULL,
  "targetBranchId" TEXT,
  "targetBranchCode" TEXT,
  "targetBranchName" TEXT,
  "quantity" DECIMAL(65,30),
  "unitCost" DECIMAL(65,30),
  "standardSalePrice" DECIMAL(65,30),
  "productStatus" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "messagesJson" JSONB NOT NULL,
  "createdProductId" TEXT,
  "updatedProductId" TEXT,
  "executionStatus" TEXT,
  "executionMessage" TEXT,
  "executedAt" TIMESTAMP(3),
  CONSTRAINT "InventoryImportLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InventoryImportBatch_createdAt_idx" ON "InventoryImportBatch"("createdAt");
CREATE INDEX "InventoryImportBatch_status_idx" ON "InventoryImportBatch"("status");
CREATE INDEX "InventoryImportLine_batchId_status_idx" ON "InventoryImportLine"("batchId", "status");
CREATE INDEX "InventoryImportLine_sku_idx" ON "InventoryImportLine"("sku");

ALTER TABLE "InventoryImportLine"
ADD CONSTRAINT "InventoryImportLine_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "InventoryImportBatch"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
