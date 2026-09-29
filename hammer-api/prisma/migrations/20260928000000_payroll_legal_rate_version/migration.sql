-- prompt-nomina-config.md Fase 2: tasas legales de nómina versionadas por
-- vigencia. Sin filas, rigen las constantes de payroll-nicaragua.ts — esta
-- tabla es aditiva y no cambia ningún resultado hasta que se cree una
-- versión (sin seed).

-- CreateTable
CREATE TABLE "PayrollLegalRateVersion" (
    "id" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "inssIntegralLaboral" DECIMAL(6,4) NOT NULL,
    "inssIntegralPatronalLt50" DECIMAL(6,4) NOT NULL,
    "inssIntegralPatronalGte50" DECIMAL(6,4) NOT NULL,
    "inssIvmRpLaboral" DECIMAL(6,4) NOT NULL,
    "inssIvmRpPatronalLt50" DECIMAL(6,4) NOT NULL,
    "inssIvmRpPatronalGte50" DECIMAL(6,4) NOT NULL,
    "inssEmployerSizeThreshold" INTEGER NOT NULL,
    "inatecRate" DECIMAL(6,4) NOT NULL,
    "irTableAnnual" JSONB NOT NULL,
    "legalBasis" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollLegalRateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollLegalRateVersion_effectiveFrom_key" ON "PayrollLegalRateVersion"("effectiveFrom");
