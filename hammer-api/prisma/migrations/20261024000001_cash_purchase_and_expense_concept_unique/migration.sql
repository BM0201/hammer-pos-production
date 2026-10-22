-- prompt-caja-gastos-pos-cobro.md Commit 1 — tabla CashPurchase (compras de
-- mercadería/flete pagadas con caja, fuera del gasto operativo), unique
-- (category, name) en ExpenseConcept (habilita el seed idempotente de abajo)
-- y los conceptos semilla nuevos. Generada SIN conexión a ninguna base.
-- 100% aditivo salvo el UNIQUE INDEX de ExpenseConcept — verificado contra
-- los 11 conceptos ya sembrados (migración 20261012000000): ninguna
-- categoría+nombre se repite hoy, así que no debería fallar al aplicar;
-- igual se recomienda una verificación de solo lectura contra producción
-- antes del push (COUNT agrupado por category,name con count>1).

-- CreateTable
CREATE TABLE "CashPurchase" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "description" TEXT NOT NULL,
    "supplierName" TEXT,
    "kind" TEXT NOT NULL,
    "linkedIntakeId" TEXT,
    "cashMovementId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashPurchase_cashMovementId_key" ON "CashPurchase"("cashMovementId");

-- CreateIndex
CREATE INDEX "CashPurchase_branchId_createdAt_idx" ON "CashPurchase"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "CashPurchase_linkedIntakeId_idx" ON "CashPurchase"("linkedIntakeId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseConcept_category_name_key" ON "ExpenseConcept"("category", "name");

-- AddForeignKey
ALTER TABLE "CashPurchase" ADD CONSTRAINT "CashPurchase_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashPurchase" ADD CONSTRAINT "CashPurchase_cashMovementId_fkey" FOREIGN KEY ("cashMovementId") REFERENCES "CashMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashPurchase" ADD CONSTRAINT "CashPurchase_linkedIntakeId_fkey" FOREIGN KEY ("linkedIntakeId") REFERENCES "MultiBranchIntake"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Conceptos semilla nuevos (idempotente — ON CONFLICT DO NOTHING con el
-- UNIQUE de arriba). "Papelería" y "Limpieza" en SUPPLIES son a propósito
-- entradas separadas de las homónimas ya existentes en MAINTENANCE: son
-- tuplas (category, name) distintas, el dueño ve la que corresponde según
-- qué categoría eligió primero.
INSERT INTO "ExpenseConcept" ("id", "category", "name", "sortOrder", "updatedAt") VALUES
  (concat('xpc_', gen_random_uuid()::text), 'TRANSPORT',    'Pasaje',              3, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'TRANSPORT',    'Taxi / mototaxi',     4, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'TRANSPORT',    'Parqueo',             5, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'CASUAL_LABOR', 'Descarga de camión',  0, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'CASUAL_LABOR', 'Carga a cliente',     1, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'CASUAL_LABOR', 'Ayudante por día',    2, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'FOOD',         'Desayuno',            0, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'FOOD',         'Almuerzo',            1, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'FOOD',         'Cena',                2, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'FOOD',         'Agua / café',         3, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'SUPPLIES',     'Bolsas',              0, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'SUPPLIES',     'Papelería',           1, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'SUPPLIES',     'Limpieza',            2, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'TAXES',        'Alcaldía',            0, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'TAXES',        'Basura',              1, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'TAXES',        'DGI',                 2, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'MAINTENANCE',  'Local',               3, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'MAINTENANCE',  'Equipo',              4, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'MAINTENANCE',  'Vehículo',            5, CURRENT_TIMESTAMP)
ON CONFLICT ("category", "name") DO NOTHING;

