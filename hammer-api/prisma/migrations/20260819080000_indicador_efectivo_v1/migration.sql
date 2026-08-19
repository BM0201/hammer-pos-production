-- prompt-indicador-efectivo-inteligente.md §2.2/§7 — política de depósito
-- por sucursal (umbral, días máximos reteniendo). Sin fila para una
-- sucursal, el indicador no calcula estado ni proyección para ella.

-- CreateTable
CREATE TABLE "BranchDepositPolicy" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "thresholdAmount" DECIMAL(65,30) NOT NULL,
    "maxDaysHolding" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchDepositPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchDepositPolicy_branchId_key" ON "BranchDepositPolicy"("branchId");

-- AddForeignKey
ALTER TABLE "BranchDepositPolicy" ADD CONSTRAINT "BranchDepositPolicy_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
