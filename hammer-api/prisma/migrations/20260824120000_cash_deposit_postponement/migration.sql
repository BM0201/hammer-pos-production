-- CreateTable
CREATE TABLE "CashDepositPostponement" (
    "id" TEXT NOT NULL,
    "cashSessionId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "reason" TEXT,
    "postponedUntil" TIMESTAMP(3) NOT NULL,
    "declaredByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashDepositPostponement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashDepositPostponement_branchId_createdAt_idx" ON "CashDepositPostponement"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "CashDepositPostponement_cashSessionId_idx" ON "CashDepositPostponement"("cashSessionId");

-- AddForeignKey
ALTER TABLE "CashDepositPostponement" ADD CONSTRAINT "CashDepositPostponement_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDepositPostponement" ADD CONSTRAINT "CashDepositPostponement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDepositPostponement" ADD CONSTRAINT "CashDepositPostponement_declaredByUserId_fkey" FOREIGN KEY ("declaredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
