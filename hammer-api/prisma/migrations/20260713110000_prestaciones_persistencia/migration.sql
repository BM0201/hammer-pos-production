-- Prestaciones sociales según ley Nicaragua — persistencia.
-- Employee lleva el saldo de vacaciones consumidas (gozadas + pagadas);
-- PayrollLine guarda el desglose de las tres provisiones además de la suma
-- `provisions` (0 en corridas históricas anteriores a esta migración).

-- AlterTable
ALTER TABLE "Employee"
  ADD COLUMN "vacationDaysTaken" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PayrollLine"
  ADD COLUMN "aguinaldoAccrual" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "vacacionesAccrual" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "indemnizacionAccrual" DECIMAL(65,30) NOT NULL DEFAULT 0;
