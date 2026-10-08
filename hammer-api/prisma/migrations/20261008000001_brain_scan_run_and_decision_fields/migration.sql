-- prompt-brain-centro-decisiones.md Fase 1.1 — columnas nuevas en
-- BrainDecision (detectorKey para el cierre automático por detector,
-- resolutionSource/resolutionNote para distinguir quién cerró qué,
-- dismissedSeverity para la regla de reapertura de "No aplica") y la
-- tabla BrainScanRun (registro real de cada escaneo — antes "último
-- escaneo" se deducía de las decisiones mismas, sin ningún registro
-- propio). Aditiva: solo agrega columnas nullable y una tabla nueva.

-- CreateEnum
CREATE TYPE "BrainScanRunStatus" AS ENUM ('RUNNING', 'OK', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "BrainDecision" ADD COLUMN "detectorKey" TEXT;
ALTER TABLE "BrainDecision" ADD COLUMN "resolutionSource" TEXT;
ALTER TABLE "BrainDecision" ADD COLUMN "resolutionNote" TEXT;
ALTER TABLE "BrainDecision" ADD COLUMN "dismissedSeverity" "BrainDecisionSeverity";

CREATE INDEX "BrainDecision_detectorKey_idx" ON "BrainDecision"("detectorKey");

-- CreateTable
CREATE TABLE "BrainScanRun" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "branchId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "BrainScanRunStatus" NOT NULL DEFAULT 'RUNNING',
    "runningLock" TEXT,
    "detectorsJson" JSONB,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "reopened" INTEGER NOT NULL DEFAULT 0,
    "autoResolved" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "actorUserId" TEXT,

    CONSTRAINT "BrainScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrainScanRun_runningLock_key" ON "BrainScanRun"("runningLock");
CREATE INDEX "BrainScanRun_status_idx" ON "BrainScanRun"("status");
CREATE INDEX "BrainScanRun_startedAt_idx" ON "BrainScanRun"("startedAt");
CREATE INDEX "BrainScanRun_branchId_idx" ON "BrainScanRun"("branchId");

-- AddForeignKey
ALTER TABLE "BrainScanRun" ADD CONSTRAINT "BrainScanRun_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrainScanRun" ADD CONSTRAINT "BrainScanRun_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
