-- prompt-carga-precios.md Fase 1 — cargas de trabajo de actualización
-- masiva de precios (borrador por producto×destino, vista previa con
-- bloqueos/avisos, aplicación atómica, reversión). Aditiva: crea tablas
-- nuevas únicamente, no toca ninguna tabla existente.

-- CreateEnum
CREATE TYPE "PriceUpdateBatchStatus" AS ENUM ('DRAFT', 'APPLYING', 'APPLIED', 'PARTIAL', 'CANCELLED');
CREATE TYPE "PriceUpdateBatchTarget" AS ENUM ('BRANCHES', 'GENERAL');
CREATE TYPE "PriceUpdateBatchSource" AS ENUM ('MANUAL', 'TRAY', 'FILE', 'REVERT');
CREATE TYPE "PriceUpdateLineStatus" AS ENUM ('PENDING', 'APPLIED', 'CONFLICT', 'BLOCKED', 'SKIPPED');

-- CreateTable
CREATE TABLE "PriceUpdateBatch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "PriceUpdateBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "target" "PriceUpdateBatchTarget" NOT NULL,
    "branchIds" TEXT[],
    "source" "PriceUpdateBatchSource" NOT NULL,
    "reason" TEXT NOT NULL,
    "revertsBatchId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "appliedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "PriceUpdateBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceUpdateLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "branchId" TEXT,
    "costSnapshot" DECIMAL(65,30),
    "currentPriceSnapshot" DECIMAL(65,30),
    "priceSourceSnapshot" TEXT NOT NULL,
    "newPrice" DECIMAL(65,30),
    "status" "PriceUpdateLineStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "trayDecisionId" TEXT,
    "appliedPreviousPrice" DECIMAL(65,30),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceUpdateLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceUpdateBatch_code_key" ON "PriceUpdateBatch"("code");
CREATE UNIQUE INDEX "PriceUpdateBatch_sequence_key" ON "PriceUpdateBatch"("sequence");
CREATE INDEX "PriceUpdateBatch_status_idx" ON "PriceUpdateBatch"("status");
CREATE INDEX "PriceUpdateBatch_createdByUserId_idx" ON "PriceUpdateBatch"("createdByUserId");

-- CreateIndex
CREATE INDEX "PriceUpdateLine_status_idx" ON "PriceUpdateLine"("status");
CREATE INDEX "PriceUpdateLine_productId_idx" ON "PriceUpdateLine"("productId");
CREATE INDEX "PriceUpdateLine_batchId_idx" ON "PriceUpdateLine"("batchId");

-- CreateIndex (expresión, no representable en schema.prisma): una línea por
-- producto×destino DENTRO de una carga. branchId es NULL para el destino
-- GENERAL — Postgres trata cada NULL como distinto en un UNIQUE normal, así
-- que sin este COALESCE dos líneas GENERAL del mismo producto en la misma
-- carga no quedarían bloqueadas por ningún índice.
CREATE UNIQUE INDEX "PriceUpdateLine_batchId_productId_branchId_key" ON "PriceUpdateLine"("batchId", "productId", COALESCE("branchId", ''));

-- AddForeignKey
ALTER TABLE "PriceUpdateBatch" ADD CONSTRAINT "PriceUpdateBatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceUpdateBatch" ADD CONSTRAINT "PriceUpdateBatch_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PriceUpdateBatch" ADD CONSTRAINT "PriceUpdateBatch_revertsBatchId_fkey" FOREIGN KEY ("revertsBatchId") REFERENCES "PriceUpdateBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceUpdateLine" ADD CONSTRAINT "PriceUpdateLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PriceUpdateBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceUpdateLine" ADD CONSTRAINT "PriceUpdateLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceUpdateLine" ADD CONSTRAINT "PriceUpdateLine_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
