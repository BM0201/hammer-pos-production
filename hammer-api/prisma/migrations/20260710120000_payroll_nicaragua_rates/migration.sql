-- Planilla V2: desglose de nómina Nicaragua por línea + tasas configurables.
-- Las columnas nuevas arrancan en 0 para las corridas históricas (su desglose
-- no existía; el neto/costo persistidos siguen siendo válidos como estaban).

-- AlterTable
ALTER TABLE "PayrollLine"
  ADD COLUMN "inssLaboral"  DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "ir"           DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "inssPatronal" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "inatec"       DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "provisions"   DECIMAL(65,30) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PayrollRateConfig" (
    "id" TEXT NOT NULL,
    "inssLaboralRate" DECIMAL(65,30) NOT NULL DEFAULT 0.07,
    "inssPatronalRate" DECIMAL(65,30) NOT NULL DEFAULT 0.215,
    "inatecRate" DECIMAL(65,30) NOT NULL DEFAULT 0.02,
    "provisionAguinaldo" DECIMAL(65,30) NOT NULL DEFAULT 0.0833333333333333,
    "provisionVacaciones" DECIMAL(65,30) NOT NULL DEFAULT 0.0833333333333333,
    "provisionIndemnizacion" DECIMAL(65,30) NOT NULL DEFAULT 0.0833333333333333,
    "provisionsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRateConfig_pkey" PRIMARY KEY ("id")
);
