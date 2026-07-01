-- Sync migration: crea la tabla PayrollDisbursement (y sus enums) que existían en
-- schema.prisma pero nunca se migraron. Su ausencia rompía /api/master/finance/summary
-- (computePayroll) con "The table public.PayrollDisbursement does not exist" (500).
--
-- También agrega el índice no-único BrainDecision_idempotencyKey_idx declarado en el
-- schema. NO se recrea el índice único parcial BrainDecision_idempotencyKey_key porque
-- ya existe en la base (migración brain_decision_center_v2) y es funcionalmente equivalente.
--
-- La demás deriva reportada por `prisma migrate diff` (ampliación de precisión Decimal,
-- renombres de índices, DROP DEFAULT de updatedAt) es cosmética, no afecta el runtime y
-- se omite deliberadamente para no arriesgar el `migrate deploy` en producción.

-- CreateEnum
CREATE TYPE "PayrollDisbursementPeriod" AS ENUM ('FIRST_HALF', 'SECOND_HALF');

-- CreateEnum
CREATE TYPE "PayrollDisbursementStatus" AS ENUM ('PENDING', 'PAID');

-- CreateTable
CREATE TABLE "PayrollDisbursement" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "payrollLineId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "period" "PayrollDisbursementPeriod" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" "PayrollDisbursementStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paidByUserId" TEXT,
    "cashMovementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollDisbursement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollDisbursement_branchId_status_scheduledDate_idx" ON "PayrollDisbursement"("branchId", "status", "scheduledDate");

-- CreateIndex
CREATE INDEX "PayrollDisbursement_payrollRunId_idx" ON "PayrollDisbursement"("payrollRunId");

-- CreateIndex
CREATE INDEX "PayrollDisbursement_cashMovementId_idx" ON "PayrollDisbursement"("cashMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollDisbursement_payrollLineId_period_key" ON "PayrollDisbursement"("payrollLineId", "period");

-- AddForeignKey
ALTER TABLE "PayrollDisbursement" ADD CONSTRAINT "PayrollDisbursement_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollDisbursement" ADD CONSTRAINT "PayrollDisbursement_payrollLineId_fkey" FOREIGN KEY ("payrollLineId") REFERENCES "PayrollLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollDisbursement" ADD CONSTRAINT "PayrollDisbursement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollDisbursement" ADD CONSTRAINT "PayrollDisbursement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollDisbursement" ADD CONSTRAINT "PayrollDisbursement_cashMovementId_fkey" FOREIGN KEY ("cashMovementId") REFERENCES "CashMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex (índice no-único declarado en schema; el único parcial _key ya existe)
CREATE INDEX IF NOT EXISTS "BrainDecision_idempotencyKey_idx" ON "BrainDecision"("idempotencyKey");
