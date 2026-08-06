CREATE TABLE "BranchProductSetting" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "minStock" DECIMAL(65,30),
    "maxStock" DECIMAL(65,30),
    "reorderPoint" DECIMAL(65,30),
    "branchCost" DECIMAL(65,30),
    "branchPrice" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchProductSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BranchProductSetting_branchId_productId_key" ON "BranchProductSetting"("branchId", "productId");
CREATE INDEX "BranchProductSetting_branchId_isAvailable_idx" ON "BranchProductSetting"("branchId", "isAvailable");
CREATE INDEX "BranchProductSetting_productId_idx" ON "BranchProductSetting"("productId");

ALTER TABLE "BranchProductSetting" ADD CONSTRAINT "BranchProductSetting_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchProductSetting" ADD CONSTRAINT "BranchProductSetting_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
