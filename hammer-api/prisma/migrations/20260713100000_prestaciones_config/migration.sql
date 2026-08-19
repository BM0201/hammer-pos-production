-- Prestaciones sociales según ley Nicaragua — configuración.
-- PayrollRateConfig deja de guardar tasas sueltas: el régimen INSS + el conteo
-- global de activos derivan laboral/patronal en código (resolveInssRates), e
-- INATEC es constante legal (2%). El toggle único de provisiones se reemplaza
-- por un modo POR PRESTACIÓN (nunca "OFF": la obligación legal no se apaga).

-- CreateEnum
CREATE TYPE "InssRegime" AS ENUM ('INTEGRAL', 'IVM_RP');

-- CreateEnum
CREATE TYPE "BenefitAccrualMode" AS ENUM ('ACCRUE_MONTHLY', 'ON_PAYMENT');

-- AlterTable: nuevas columnas de configuración
ALTER TABLE "PayrollRateConfig"
  ADD COLUMN "inssRegime" "InssRegime" NOT NULL DEFAULT 'INTEGRAL',
  ADD COLUMN "aguinaldoMode" "BenefitAccrualMode" NOT NULL DEFAULT 'ACCRUE_MONTHLY',
  ADD COLUMN "vacacionesMode" "BenefitAccrualMode" NOT NULL DEFAULT 'ACCRUE_MONTHLY',
  ADD COLUMN "indemnizacionMode" "BenefitAccrualMode" NOT NULL DEFAULT 'ACCRUE_MONTHLY',
  ADD COLUMN "salarioMinimoSectorial" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- Migración de datos: quien tenía las provisiones apagadas pasa a reconocerlas
-- al pago (el equivalente legal más cercano a "no provisionar mensualmente").
UPDATE "PayrollRateConfig"
SET "aguinaldoMode" = 'ON_PAYMENT',
    "vacacionesMode" = 'ON_PAYMENT',
    "indemnizacionMode" = 'ON_PAYMENT'
WHERE "provisionsEnabled" = false;

-- AlterTable: se eliminan las tasas sueltas (ahora derivadas o constantes)
ALTER TABLE "PayrollRateConfig"
  DROP COLUMN "inssLaboralRate",
  DROP COLUMN "inssPatronalRate",
  DROP COLUMN "inatecRate",
  DROP COLUMN "provisionAguinaldo",
  DROP COLUMN "provisionVacaciones",
  DROP COLUMN "provisionIndemnizacion",
  DROP COLUMN "provisionsEnabled";
