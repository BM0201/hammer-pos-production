-- prompt-inventario-v3.md Fase 1 — estado precalculado por producto y
-- sucursal (ProductBranchState) y por producto (ProductCatalogState), para
-- que la lista/overview de inventario filtren y ordenen en la base en vez
-- de traer todo el catálogo y calcular en memoria. Aditiva: crea tablas
-- nuevas únicamente, no toca ninguna tabla existente. Backfill en
-- scripts/rebuild-product-state.ts (no en esta migración — recorre todo el
-- catálogo × sucursales, puede ser pesado).

-- CreateEnum
CREATE TYPE "ProductStockStatus" AS ENUM ('NEGATIVE', 'ZERO', 'LOW', 'OK');

-- CreateTable
CREATE TABLE "ProductBranchState" (
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "quantityOnHand" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "effectiveCost" DECIMAL(65,30),
    "costSource" TEXT,
    "effectivePrice" DECIMAL(65,30),
    "priceSource" TEXT,
    "marginPercent" DECIMAL(65,30),
    "minQuantity" DECIMAL(65,30),
    "reorderPoint" DECIMAL(65,30),
    "stockStatus" "ProductStockStatus" NOT NULL DEFAULT 'OK',
    "lastMovementAt" TIMESTAMP(3),
    "units90d" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "revenue90d" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductBranchState_pkey" PRIMARY KEY ("productId", "branchId")
);

-- CreateTable
CREATE TABLE "ProductCatalogState" (
    "productId" TEXT NOT NULL,
    "hasCode" BOOLEAN NOT NULL DEFAULT false,
    "hasCost" BOOLEAN NOT NULL DEFAULT false,
    "hasPrice" BOOLEAN NOT NULL DEFAULT false,
    "costEqualsPrice" BOOLEAN NOT NULL DEFAULT false,
    "totalQuantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCatalogState_pkey" PRIMARY KEY ("productId")
);

-- CreateIndex
CREATE INDEX "ProductBranchState_branchId_stockStatus_idx" ON "ProductBranchState"("branchId", "stockStatus");
CREATE INDEX "ProductBranchState_branchId_marginPercent_idx" ON "ProductBranchState"("branchId", "marginPercent");
CREATE INDEX "ProductBranchState_branchId_lastMovementAt_idx" ON "ProductBranchState"("branchId", "lastMovementAt");

-- AddForeignKey
ALTER TABLE "ProductBranchState" ADD CONSTRAINT "ProductBranchState_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductBranchState" ADD CONSTRAINT "ProductBranchState_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCatalogState" ADD CONSTRAINT "ProductCatalogState_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
