-- Fase 3 de prompt-flujo-velocidad.md: denormaliza branchId en
-- SaleOrderLine para que branchProductScopeFilter (catalog/service.ts) deje
-- de armar un JOIN SaleOrderLine->SaleOrder por cada producto evaluado.
--
-- Nullable a propósito: las filas existentes quedan en NULL hasta que corra
-- el backfill por lotes (scripts/backfill-sale-order-line-branch-id.ts,
-- fuera de esta migración a propósito — no bloquea el deploy con un UPDATE
-- largo si la tabla ya creció). Todo código nuevo que crea una línea
-- (addSaleOrderLine en sales/service.ts, offline-sync.service.ts) ya la
-- llena en el INSERT — sin esto, cada línea nueva nacería con branchId=null
-- otra vez y el backfill nunca alcanzaría al presente.
--
-- Al momento de escribir esto SaleOrderLine tiene ~2460 filas (verificado
-- contra la DB real, solo lectura) — el ADD COLUMN nullable y el índice son
-- instantáneos a este tamaño. Si esta migración se aplica mucho más tarde
-- contra una tabla ya grande, considerar CREATE INDEX CONCURRENTLY en un
-- paso aparte en vez de dentro de esta misma migración transaccional.

-- AlterTable
ALTER TABLE "SaleOrderLine" ADD COLUMN "branchId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SaleOrderLine_branchId_productId_idx" ON "SaleOrderLine"("branchId", "productId");

-- AddForeignKey
ALTER TABLE "SaleOrderLine" ADD CONSTRAINT "SaleOrderLine_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
