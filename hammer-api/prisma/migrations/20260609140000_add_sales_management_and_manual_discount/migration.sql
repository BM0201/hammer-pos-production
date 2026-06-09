-- Descuento manual a nivel de orden (Feature 3)
ALTER TABLE "SaleOrder" ADD COLUMN "manualDiscountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- Gestión de ventas: pruebas y anulaciones (Feature 4)
ALTER TABLE "SaleOrder" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SaleOrder" ADD COLUMN "voidedAt" TIMESTAMP(3);
ALTER TABLE "SaleOrder" ADD COLUMN "voidedByUserId" TEXT;
ALTER TABLE "SaleOrder" ADD COLUMN "voidReason" TEXT;

-- Índices para filtrar/excluir eficientemente en reportes y métricas
CREATE INDEX "SaleOrder_isTest_idx" ON "SaleOrder"("isTest");
CREATE INDEX "SaleOrder_voidedAt_idx" ON "SaleOrder"("voidedAt");
CREATE INDEX "SaleOrder_voidedByUserId_idx" ON "SaleOrder"("voidedByUserId");

-- FK de auditoría hacia el usuario que anuló/marcó la venta
ALTER TABLE "SaleOrder" ADD CONSTRAINT "SaleOrder_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
