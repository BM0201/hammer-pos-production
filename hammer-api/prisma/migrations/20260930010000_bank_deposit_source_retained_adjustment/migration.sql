-- CreateEnum
CREATE TYPE "BankDepositSource" AS ENUM ('CUSTODY', 'DIRECT_FROM_RETAINED');

-- AlterTable
ALTER TABLE "BankDeposit" ADD COLUMN     "source" "BankDepositSource" NOT NULL DEFAULT 'CUSTODY';

-- CreateTable
CREATE TABLE "RetainedCashAdjustment" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "reason" TEXT NOT NULL,
    "custodyAccountId" TEXT,
    "bankDepositId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetainedCashAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetainedCashAdjustment_branchId_createdAt_idx" ON "RetainedCashAdjustment"("branchId", "createdAt");

-- AddForeignKey
ALTER TABLE "RetainedCashAdjustment" ADD CONSTRAINT "RetainedCashAdjustment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetainedCashAdjustment" ADD CONSTRAINT "RetainedCashAdjustment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
