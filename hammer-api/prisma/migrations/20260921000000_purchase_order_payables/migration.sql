-- Fase 1 de prompt-cxp.md: modelo de cuentas por pagar. La deuda y el saldo
-- NUNCA se guardan (se calculan siempre — mismo principio que ya gobierna
-- tesorería) — estas columnas son solo lo que hace falta para calcular:
-- días de crédito, fecha de vencimiento, y el vínculo pago→orden/proveedor.

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN "dueDate" TIMESTAMP(3),
ADD COLUMN "paymentTermDaysSnapshot" INTEGER;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "paymentTermDays" INTEGER;

-- AlterTable
ALTER TABLE "TreasuryEntry" ADD COLUMN "purchaseOrderId" TEXT,
ADD COLUMN "supplierId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PurchaseOrder_dueDate_idx" ON "PurchaseOrder"("dueDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TreasuryEntry_purchaseOrderId_idx" ON "TreasuryEntry"("purchaseOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TreasuryEntry_supplierId_idx" ON "TreasuryEntry"("supplierId");

-- AddForeignKey
ALTER TABLE "TreasuryEntry" ADD CONSTRAINT "TreasuryEntry_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryEntry" ADD CONSTRAINT "TreasuryEntry_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
