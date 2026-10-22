-- prompt-conteo-delegado.md Commit 1 — conteo por escaneo delegado,
-- guardado en el servidor (antes no existía: la única "entrada" era la
-- Entrada de inventario PHYSICAL_COUNT, que aplica el stock directo, sin
-- borrador ni aprobación). 100% aditivo: un enum nuevo + 4 tablas nuevas,
-- ninguna tabla existente pierde ni cambia una columna. Generada SIN
-- conexión a ninguna base (prisma migrate diff --from-schema-datamodel
-- <antes> --to-schema-datamodel <después>, por el incidente del 22 oct).
--
-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "categoryIds" TEXT[],
    "blind" BOOLEAN NOT NULL DEFAULT true,
    "assignedUserIds" TEXT[],
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "appliedIntakeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "stockCountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "countedBase" DECIMAL(18,4) NOT NULL,
    "scannedUnitLabel" TEXT,
    "systemBaseAtLastScan" DECIMAL(18,4),
    "lastScanAt" TIMESTAMP(3) NOT NULL,
    "lastScanById" TEXT NOT NULL,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountEvent" (
    "id" TEXT NOT NULL,
    "stockCountId" TEXT NOT NULL,
    "productId" TEXT,
    "code" TEXT,
    "delta" DECIMAL(18,4),
    "setTo" DECIMAL(18,4),
    "kind" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCountEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountUnknownCode" (
    "id" TEXT NOT NULL,
    "stockCountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "note" TEXT,
    "resolvedProductId" TEXT,

    CONSTRAINT "StockCountUnknownCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_appliedIntakeId_key" ON "StockCount"("appliedIntakeId");

-- CreateIndex
CREATE INDEX "StockCount_branchId_status_idx" ON "StockCount"("branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_stockCountId_productId_key" ON "StockCountLine"("stockCountId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountEvent_clientEventId_key" ON "StockCountEvent"("clientEventId");

-- CreateIndex
CREATE INDEX "StockCountEvent_stockCountId_createdAt_idx" ON "StockCountEvent"("stockCountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountUnknownCode_stockCountId_code_key" ON "StockCountUnknownCode"("stockCountId", "code");

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_appliedIntakeId_fkey" FOREIGN KEY ("appliedIntakeId") REFERENCES "MultiBranchIntake"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_lastScanById_fkey" FOREIGN KEY ("lastScanById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountEvent" ADD CONSTRAINT "StockCountEvent_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountEvent" ADD CONSTRAINT "StockCountEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountEvent" ADD CONSTRAINT "StockCountEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountUnknownCode" ADD CONSTRAINT "StockCountUnknownCode_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountUnknownCode" ADD CONSTRAINT "StockCountUnknownCode_resolvedProductId_fkey" FOREIGN KEY ("resolvedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

