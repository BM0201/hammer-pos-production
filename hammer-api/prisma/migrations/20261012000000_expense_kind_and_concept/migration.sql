-- prompt-gastos-semana-quincena.md Fase 1 — pagado ≠ presupuesto, y
-- concepto del gasto. Aditiva: ninguna tabla existente pierde filas.
-- "kind" se agrega con un DEFAULT temporal (para poder backfillear las
-- filas existentes) y se le quita el default al final — createOperatingExpense/
-- recordRetainedCashExpenseTx/syncPostedPayrollLineExpense son los únicos 3
-- escritores y cada uno lo decide explícito desde ahora.

-- CreateEnum
CREATE TYPE "ExpenseKind" AS ENUM ('RECURRING', 'PAID', 'PAYROLL_SYNC');

-- CreateTable
CREATE TABLE "ExpenseConcept" (
    "id" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseConcept_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseConcept_category_isActive_idx" ON "ExpenseConcept"("category", "isActive");

-- AlterTable: columnas nuevas de OperatingExpense
ALTER TABLE "OperatingExpense" ADD COLUMN "kind" "ExpenseKind" NOT NULL DEFAULT 'RECURRING';
ALTER TABLE "OperatingExpense" ADD COLUMN "conceptId" TEXT;
ALTER TABLE "OperatingExpense" ADD COLUMN "payee" TEXT;
ALTER TABLE "OperatingExpense" ADD COLUMN "receiptNumber" TEXT;
ALTER TABLE "OperatingExpense" ADD COLUMN "paidAt" TIMESTAMP(3);

-- Backfill 1: sincronización automática de planilla — isAutoCalculated +
-- categoría PAYROLL. Antes que PAID: una línea de planilla también puede
-- tener... en la práctica nunca tiene cashMovementId, pero la prioridad del
-- doc es explícita (PAYROLL_SYNC primero) y el WHERE de abajo la respeta
-- excluyendo lo que ya quedó marcado acá.
UPDATE "OperatingExpense"
SET "kind" = 'PAYROLL_SYNC', "paidAt" = "effectiveFrom"
WHERE "isAutoCalculated" = true AND "category" = 'PAYROLL';

-- Backfill 2: pagado — tiene cashMovementId (POS), o un TreasuryEntry lo
-- referencia (efectivo retenido / banco), o effectiveFrom y effectiveTo son
-- el mismo día (un punto en el tiempo, no un rango de vigencia mensual).
UPDATE "OperatingExpense" e
SET "kind" = 'PAID', "paidAt" = e."effectiveFrom"
WHERE e."kind" != 'PAYROLL_SYNC'
  AND (
    e."cashMovementId" IS NOT NULL
    OR EXISTS (SELECT 1 FROM "TreasuryEntry" te WHERE te."expensePaymentId" = e."id")
    OR (e."effectiveTo" IS NOT NULL AND e."effectiveFrom"::date = e."effectiveTo"::date)
  );

-- Backfill 3 (Fase 1.2) — un PAID sin effectiveTo (el bug de fondo: un gasto
-- pagado en caja sin fecha de fin, sumándose como mensual para siempre)
-- recibe effectiveTo = effectiveFrom.
UPDATE "OperatingExpense"
SET "effectiveTo" = "effectiveFrom"
WHERE "kind" = 'PAID' AND "effectiveTo" IS NULL;

-- El resto (no tocado por los UPDATE de arriba) se queda en el default
-- 'RECURRING' que ya se escribió al agregar la columna — es exactamente la
-- regla "el resto RECURRING" del doc.

ALTER TABLE "OperatingExpense" ALTER COLUMN "kind" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "OperatingExpense_kind_idx" ON "OperatingExpense"("kind");
CREATE INDEX "OperatingExpense_conceptId_idx" ON "OperatingExpense"("conceptId");

-- AddForeignKey
ALTER TABLE "OperatingExpense" ADD CONSTRAINT "OperatingExpense_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "ExpenseConcept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Semilla mínima de conceptos — editable después desde Finanzas (Fase 3).
INSERT INTO "ExpenseConcept" ("id", "category", "name", "sortOrder", "updatedAt") VALUES
  (concat('xpc_', gen_random_uuid()::text), 'TRANSPORT',  'Combustible',             0, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'TRANSPORT',  'Flete externo',           1, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'TRANSPORT',  'Reparación de vehículo',  2, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'UTILITIES',  'Luz',                     0, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'UTILITIES',  'Agua',                    1, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'UTILITIES',  'Internet',                2, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'UTILITIES',  'Teléfono',                3, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'MAINTENANCE','Limpieza',                0, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'MAINTENANCE','Reparación del local',    1, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'MAINTENANCE','Papelería',               2, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'OTHER',      'Varios',                  0, CURRENT_TIMESTAMP);
