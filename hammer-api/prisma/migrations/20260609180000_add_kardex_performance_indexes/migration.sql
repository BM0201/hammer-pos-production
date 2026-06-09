-- Kardex performance indexes
-- Optimizan consultas del Kardex que filtran por sucursal o producto dentro de
-- un rango de fechas y ordenan por createdAt. Son retrocompatibles (solo crean
-- indices, no alteran datos). El indice (movementType, createdAt) ya existe.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InventoryMovement_branchId_createdAt_idx" ON "InventoryMovement"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InventoryMovement_productId_createdAt_idx" ON "InventoryMovement"("productId", "createdAt");
