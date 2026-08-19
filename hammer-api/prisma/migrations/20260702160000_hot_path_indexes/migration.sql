-- Índices para las rutas de consulta más calientes detectadas en la revisión de rendimiento:
--  1. SaleOrderLine.productId: señales de venta, top-selling, analytics y detectores Brain
--     agrupan/filtran líneas por producto; sin índice era scan completo de la tabla más grande.
--  2. Payment(status, paidAt): el resumen realtime (poll cada 12-15s por usuario POS) filtra
--     pagos por estado + ventana de tiempo.
--  3. SaleOrder(branchId, createdAt): dashboard de ventas y ventanas de día operativo.
--  4. AuditLog(entityId, occurredAt): historial de producto consulta por entityId sin
--     entityType; la tabla de auditoría es la de mayor crecimiento del sistema.

-- CreateIndex
CREATE INDEX "SaleOrderLine_productId_idx" ON "SaleOrderLine"("productId");

-- CreateIndex
CREATE INDEX "Payment_status_paidAt_idx" ON "Payment"("status", "paidAt");

-- CreateIndex
CREATE INDEX "SaleOrder_branchId_createdAt_idx" ON "SaleOrder"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_occurredAt_idx" ON "AuditLog"("entityId", "occurredAt");
