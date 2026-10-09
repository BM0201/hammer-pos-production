-- prompt-codigos-y-duplicados.md Fase 3 — unificar productos duplicados.
-- Aditiva: Product.mergedIntoProductId (espejo rápido para findProductByCode
-- y para ocultar el producto fusionado del catálogo/búsqueda) + ProductMerge
-- (registro de auditoría completo: quién, cuándo, el plan ejecutado).
-- Ninguna tabla existente pierde filas ni columnas.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "mergedIntoProductId" TEXT;

-- CreateTable
CREATE TABLE "ProductMerge" (
    "id" TEXT NOT NULL,
    "survivingProductId" TEXT NOT NULL,
    "mergedProductId" TEXT NOT NULL,
    "survivingSku" TEXT NOT NULL,
    "survivingName" TEXT NOT NULL,
    "mergedSku" TEXT NOT NULL,
    "mergedName" TEXT NOT NULL,
    "reason" TEXT,
    "planJson" JSONB NOT NULL,
    "executedByUserId" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductMerge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductMerge_mergedProductId_key" ON "ProductMerge"("mergedProductId");
CREATE INDEX "ProductMerge_survivingProductId_idx" ON "ProductMerge"("survivingProductId");
CREATE INDEX "Product_mergedIntoProductId_idx" ON "Product"("mergedIntoProductId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_mergedIntoProductId_fkey" FOREIGN KEY ("mergedIntoProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductMerge" ADD CONSTRAINT "ProductMerge_survivingProductId_fkey" FOREIGN KEY ("survivingProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductMerge" ADD CONSTRAINT "ProductMerge_mergedProductId_fkey" FOREIGN KEY ("mergedProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductMerge" ADD CONSTRAINT "ProductMerge_executedByUserId_fkey" FOREIGN KEY ("executedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
