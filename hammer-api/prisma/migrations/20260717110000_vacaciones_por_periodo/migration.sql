-- Vacaciones: de acumulado sin cortes a ledger + período de aniversario laboral.
--
-- Antes, el saldo era 2.5 × TOTAL de meses desde la contratación (sin cortes)
-- menos un contador suelto (Employee.vacationDaysTaken) que dependía de que
-- alguien lo actualizara manualmente — sin fecha ni rastro de qué pasó. Si se
-- olvidaba una entrada, el saldo mostrado quedaba mal por años.
--
-- Ahora: VacationEntry es un ledger (fecha + días + tipo GOZADAS/PAGADAS) y el
-- acumulado se calcula por PERÍODO DE ANIVERSARIO LABORAL (cada 12 meses desde
-- la fecha de ingreso), igual que hace cualquier sistema de nómina serio — el
-- total acumulado de por vida es matemáticamente el mismo, pero ahora es
-- auditable período por período.

-- CreateTable
CREATE TABLE "VacationEntry" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "days" DECIMAL(65,30) NOT NULL,
  "kind" TEXT NOT NULL,
  "notes" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VacationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VacationEntry_employeeId_date_idx" ON "VacationEntry"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "VacationEntry"
  ADD CONSTRAINT "VacationEntry_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Migra el saldo histórico (contador suelto) a UNA entrada del ledger, para no
-- perder el dato ya registrado antes de eliminar la columna vieja.
INSERT INTO "VacationEntry" ("id", "employeeId", "date", "days", "kind", "notes", "createdAt")
SELECT
  concat('ven_', gen_random_uuid()::text),
  "id",
  CURRENT_TIMESTAMP,
  "vacationDaysTaken",
  'GOZADAS',
  'Saldo histórico migrado automáticamente (antes: contador Employee.vacationDaysTaken)',
  CURRENT_TIMESTAMP
FROM "Employee"
WHERE "vacationDaysTaken" > 0;

-- AlterTable
ALTER TABLE "Employee" DROP COLUMN "vacationDaysTaken";
