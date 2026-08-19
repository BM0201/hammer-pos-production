CREATE TABLE "Supplier" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "commercialName" TEXT,
  "ruc" TEXT,
  "phone" TEXT,
  "phone2" TEXT,
  "email" TEXT,
  "address" TEXT,
  "contactName" TEXT,
  "contactPhone" TEXT,
  "bankName" TEXT,
  "bankAccountNumber" TEXT,
  "accountHolder" TEXT,
  "paymentTerms" TEXT,
  "creditLimit" DECIMAL,
  "notes" TEXT,
  "category" TEXT,
  "defaultCurrency" TEXT,
  "leadTimeDays" INTEGER,
  "preferredPaymentMethod" TEXT,
  "supplierCode" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Supplier_ruc_key" ON "Supplier"("ruc");
CREATE UNIQUE INDEX "Supplier_supplierCode_key" ON "Supplier"("supplierCode");
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");
CREATE INDEX "Supplier_isActive_idx" ON "Supplier"("isActive");

ALTER TABLE "Product"
  ADD COLUMN "globalCost" DECIMAL,
  ADD COLUMN "averageCost" DECIMAL,
  ADD COLUMN "lastPurchaseCost" DECIMAL,
  ADD COLUMN "costUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "costSource" TEXT,
  ADD COLUMN "costUpdatedByUserId" TEXT;

ALTER TABLE "BranchProductSetting"
  ADD COLUMN "minPrice" DECIMAL,
  ADD COLUMN "wholesalePrice" DECIMAL,
  ADD COLUMN "priceSource" TEXT,
  ADD COLUMN "marginPercent" DECIMAL,
  ADD COLUMN "lastPriceUpdateAt" TIMESTAMP(3),
  ADD COLUMN "priceUpdatedByUserId" TEXT;

ALTER TABLE "SaleOrderLine"
  ADD COLUMN "costSnapshot" DECIMAL,
  ADD COLUMN "marginSnapshot" DECIMAL,
  ADD COLUMN "marginPercentSnapshot" DECIMAL,
  ADD COLUMN "costSourceSnapshot" TEXT;

ALTER TABLE "PurchaseOrder"
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "supplierNameSnapshot" TEXT,
  ADD COLUMN "supplierSnapshotJson" JSONB;

ALTER TABLE "PurchaseOrderLine"
  ADD COLUMN "previousGlobalCost" DECIMAL,
  ADD COLUMN "newGlobalCost" DECIMAL,
  ADD COLUMN "previousAverageCost" DECIMAL,
  ADD COLUMN "newAverageCost" DECIMAL,
  ADD COLUMN "receivedQtySnapshot" DECIMAL,
  ADD COLUMN "supplierIdSnapshot" TEXT,
  ADD COLUMN "supplierNameSnapshot" TEXT;

CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Product" p
SET
  "averageCost" = cost.avg_cost,
  "globalCost" = cost.avg_cost,
  "costUpdatedAt" = CURRENT_TIMESTAMP,
  "costSource" = 'BACKFILL_INVENTORY_WAC'
FROM (
  SELECT "productId", AVG(NULLIF("weightedAverageCost", 0)) AS avg_cost
  FROM "InventoryBalance"
  WHERE "weightedAverageCost" > 0
  GROUP BY "productId"
) cost
WHERE p."id" = cost."productId"
  AND p."averageCost" IS NULL;

