-- prompt-codigos-y-duplicados.md Fase 1 — varios códigos de barra por
-- producto. Product.barcode se MANTIENE (copia del código principal, para
-- no romper POS/caché/etiquetas/búsqueda) — esta tabla nueva es la fuente
-- de verdad desde ahora, solo se escribe desde catalog/product-barcode-service.ts.
-- Aditiva + backfill de datos existentes, ninguna tabla existente pierde filas.

-- CreateEnum
CREATE TYPE "ProductBarcodeKind" AS ENUM ('FACTORY', 'INTERNAL', 'SUPPLIER');

-- CreateTable
CREATE TABLE "ProductBarcode" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "ProductBarcodeKind" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "ProductBarcode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductBarcode_code_key" ON "ProductBarcode"("code");
CREATE INDEX "ProductBarcode_productId_idx" ON "ProductBarcode"("productId");

-- AddForeignKey
ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill — un Product.barcode "" (vacío, nunca debió guardarse así) se
-- limpia ANTES del backfill para no crear una fila con code='' (violaría
-- cualquier validación futura y no es un código real).
UPDATE "Product" SET "barcode" = NULL WHERE "barcode" IS NOT NULL AND trim("barcode") = '';

-- Backfill — cada Product.barcode no nulo pasa a ser su código PRINCIPAL.
-- kind = INTERNAL si ya sigue el patrón HMR- (prompt-alta-productos-qr.md),
-- FACTORY en cualquier otro caso. Ver classifyBackfillBarcode en
-- product-barcode-service.ts — MISMA regla, con un test que los mantiene
-- sincronizados (un cambio en uno sin el otro no se nota solo en TS).
INSERT INTO "ProductBarcode" ("id", "productId", "code", "kind", "isPrimary", "createdAt")
SELECT
  concat('pbc_', gen_random_uuid()::text),
  "id",
  "barcode",
  CASE WHEN "barcode" LIKE 'HMR-%' THEN 'INTERNAL'::"ProductBarcodeKind" ELSE 'FACTORY'::"ProductBarcodeKind" END,
  true,
  CURRENT_TIMESTAMP
FROM "Product"
WHERE "barcode" IS NOT NULL;
