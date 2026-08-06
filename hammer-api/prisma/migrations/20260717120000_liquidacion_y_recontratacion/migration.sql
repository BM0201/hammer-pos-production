-- Liquidación y recontratación INMEDIATA (rollover) + baja definitiva
-- (termination), unificadas en un solo registro contable auditable.
--
-- Employee.lastLiquidationAt: cuando se liquida-y-recontrata, este campo
-- resetea el reloj de antigüedad para indemnización/vacaciones SIN
-- interrumpir el empleo (isActive sigue true) — evita que la indemnización
-- crezca sin límite ("bola de nieve") si nunca se liquida. startDate NUNCA
-- se toca (permanece el ingreso real original, para historial/continuidad).

-- AlterTable
ALTER TABLE "Employee"
  ADD COLUMN "lastLiquidationAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmployeeSettlement" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "causal" TEXT,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "aguinaldoPaid" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "vacationDaysPaid" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "vacationValuePaid" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "indemnizacionPaid" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "loanDeduction" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "totalPaid" DECIMAL(65,30) NOT NULL,
  "notes" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmployeeSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeSettlement_employeeId_date_idx" ON "EmployeeSettlement"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "EmployeeSettlement"
  ADD CONSTRAINT "EmployeeSettlement_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
