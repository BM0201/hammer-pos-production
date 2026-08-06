-- Product stock groups for convertible commercial presentations.
CREATE TABLE "ProductStockGroup" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "baseUnit" TEXT NOT NULL,
  "categoryId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductStockGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductStockGroupMember" (
  "id" TEXT NOT NULL,
  "stockGroupId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "saleUnit" TEXT NOT NULL,
  "conversionFactor" DECIMAL(65,30) NOT NULL,
  "isCanonical" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductStockGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductStockGroup_code_key" ON "ProductStockGroup"("code");
CREATE INDEX "ProductStockGroup_categoryId_idx" ON "ProductStockGroup"("categoryId");
CREATE INDEX "ProductStockGroup_isActive_idx" ON "ProductStockGroup"("isActive");

CREATE UNIQUE INDEX "ProductStockGroupMember_stockGroupId_productId_key" ON "ProductStockGroupMember"("stockGroupId", "productId");
CREATE INDEX "ProductStockGroupMember_productId_idx" ON "ProductStockGroupMember"("productId");
CREATE INDEX "ProductStockGroupMember_stockGroupId_isActive_idx" ON "ProductStockGroupMember"("stockGroupId", "isActive");

ALTER TABLE "ProductStockGroup"
  ADD CONSTRAINT "ProductStockGroup_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductStockGroupMember"
  ADD CONSTRAINT "ProductStockGroupMember_stockGroupId_fkey"
  FOREIGN KEY ("stockGroupId") REFERENCES "ProductStockGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductStockGroupMember"
  ADD CONSTRAINT "ProductStockGroupMember_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
