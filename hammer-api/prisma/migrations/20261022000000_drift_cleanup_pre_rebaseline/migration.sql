-- prompt-migraciones-rebaseline.md Fase 0 — producción tenía drift real
-- contra schema.prisma, de antes del rebaseline de mayo
-- (20260518000000_current_postgresql_baseline): ninguna migración del
-- repo crea ni toca las columnas de abajo, así que ya eran drift desde
-- entonces. Este cleanup corre ANTES de generar baseline_v2 — si no se
-- corrige primero, el paso final de producción (`migrate resolve
-- --applied`, que NO ejecuta SQL, solo marca la migración como aplicada)
-- dejaría este drift sin corregir para siempre.
--
-- Alcance DELIBERADAMENTE chico — solo lo verificado de solo lectura:
--   InventoryMovement.actorUserId/balanceAfter/unit: COUNT(*) WHERE IS NOT
--   NULL = 0 las tres. Reemplazadas por userId y los snapshots
--   closedPackage*/looseUnit*/equivalentBase*, sin referencias en el código.
--
-- NO incluye (dueño decide después, tienen datos reales):
--   SaleOrder.isTest (2577/2577 filas, pero solo 1 con valor TRUE real),
--   SaleOrder.manualDiscountAmount (2577/2577 filas, pero siempre 0 — nunca
--     un descuento real), SaleOrder.voidReason/voidedAt/voidedByUserId
--     (solo 5 filas, con texto real: "Se volverá a hacer la factura",
--     "Bulto en el sistema", etc. — del 2026-06-09, antes de que existiera
--     SaleCancellation). Sus índices (SaleOrder_isTest_idx,
--     SaleOrder_voidedAt_idx, SaleOrder_voidedByUserId_idx) y su FK
--     (SaleOrder_voidedByUserId_fkey) tampoco se tocan todavía.
--
-- NO incluye (no son "columna confirmada vacía" ni "renombre de índice"):
--   InventoryMovement_branchId_createdAt_idx / _productId_createdAt_idx
--     (redundantes — ya existe InventoryMovement_branchId_productId_
--     createdAt_idx — pero esto es un DROP, no un rename);
--   ProductionRecipe_recipeFamily_idx / _recipeType_idx (mismo caso: las
--     columnas siguen vivas, solo el índice individual sobra).
--   Quedan pendientes de una decisión aparte.
--
-- NO incluye (precedente explícito, ver 20260701000000_sync_payroll_
-- disbursement_and_schema/migration.sql): BrainDecision_idempotencyKey_key
-- (índice único parcial) — ya existe en producción, funcionalmente
-- equivalente al índice único simple que generaría schema.prisma.
--
-- Decimal (11 columnas) y el DROP DEFAULT de updatedAt (BrainDecision,
-- OperationalDay) NO están acá: se resolvieron declarando la precisión
-- real (@db.Decimal sin argumentos, ya existente en producción) y
-- @default(now()) en schema.prisma — cero cambios en la base.

-- DropForeignKey — solo la de actorUserId (la única de las 3 columnas que tiene FK propia).
ALTER TABLE "InventoryMovement" DROP CONSTRAINT "InventoryMovement_actorUserId_fkey";

-- DropIndex
DROP INDEX "InventoryMovement_actorUserId_idx";

-- AlterTable — las 3 columnas confirmadas en 0 filas (ver conteos arriba).
ALTER TABLE "InventoryMovement" DROP COLUMN "actorUserId",
DROP COLUMN "balanceAfter",
DROP COLUMN "unit";

-- RenameIndex — ProductBarcode: el índice viejo y el nuevo son LA MISMA
-- definición (USING btree (code text_pattern_ops)), solo cambia el
-- nombre. Un rename es atómico: nunca hay una ventana sin índice (más
-- seguro que crear el nuevo y borrar el viejo en dos pasos separados).
ALTER INDEX "ProductBarcode_code_prefix_idx" RENAME TO "ProductBarcode_code_idx";

-- RenameConstraint — nombres heredados del modelo viejo "BankAccount"
-- (renombrado a TreasuryAccount hace tiempo); Postgres nunca renombró los
-- objetos internos. Puro nombre, cero cambio de comportamiento ni de datos.
ALTER TABLE "TreasuryAccount" RENAME CONSTRAINT "BankAccount_pkey" TO "TreasuryAccount_pkey";
ALTER TABLE "TreasuryAccount" RENAME CONSTRAINT "BankAccount_branchId_fkey" TO "TreasuryAccount_branchId_fkey";

-- RenameIndex — mismo caso: el nombre interno del índice quedó con el
-- nombre viejo del campo/modelo antes de un refactor (branch → branchId,
-- customer → customerId, etc.); nunca cambia qué columnas cubre el índice.
ALTER INDEX "CreditNote_customer_status_idx" RENAME TO "CreditNote_customerId_status_idx";
ALTER INDEX "InternalFreightRoute_originBranchId_destinationBranchId_isActiv" RENAME TO "InternalFreightRoute_originBranchId_destinationBranchId_isA_idx";
ALTER INDEX "InventoryConditionBalance_branch_condition_idx" RENAME TO "InventoryConditionBalance_branchId_condition_idx";
ALTER INDEX "InventoryConditionBalance_branch_product_condition_key" RENAME TO "InventoryConditionBalance_branchId_productId_condition_key";
ALTER INDEX "InventoryConditionBalance_product_condition_idx" RENAME TO "InventoryConditionBalance_productId_condition_idx";
ALTER INDEX "Refund_branch_status_idx" RENAME TO "Refund_branchId_status_idx";
ALTER INDEX "SaleCancellation_branch_status_idx" RENAME TO "SaleCancellation_branchId_status_idx";
ALTER INDEX "SaleReturn_branch_status_idx" RENAME TO "SaleReturn_branchId_status_idx";
ALTER INDEX "SaleReturnItem_condition_destination_idx" RENAME TO "SaleReturnItem_condition_inventoryDestination_idx";
ALTER INDEX "BankAccount_branchId_isActive_idx" RENAME TO "TreasuryAccount_branchId_isActive_idx";
