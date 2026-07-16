-- Sistema de asistencia correlacionado con la nómina.
-- Cada FALTA INJUSTIFICADA descuenta un día de pago (salario diario = mensual
-- ÷ 30) en el cálculo del mes; las justificadas se registran pero no
-- descuentan. PayrollLine guarda los días y el monto no devengado del período.

-- CreateTable
CREATE TABLE "EmployeeAbsence" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "kind" TEXT NOT NULL,
  "notes" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmployeeAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAbsence_employeeId_date_key" ON "EmployeeAbsence"("employeeId", "date");

-- CreateIndex
CREATE INDEX "EmployeeAbsence_employeeId_date_idx" ON "EmployeeAbsence"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "EmployeeAbsence"
  ADD CONSTRAINT "EmployeeAbsence_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "PayrollLine"
  ADD COLUMN "absenceDays" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "absenceDeduction" DECIMAL(65,30) NOT NULL DEFAULT 0;
