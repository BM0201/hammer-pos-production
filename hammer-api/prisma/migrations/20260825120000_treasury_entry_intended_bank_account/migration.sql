-- AlterTable
ALTER TABLE "TreasuryEntry" ADD COLUMN "intendedBankAccountId" TEXT;

-- CreateIndex
CREATE INDEX "TreasuryEntry_intendedBankAccountId_idx" ON "TreasuryEntry"("intendedBankAccountId");

-- AddForeignKey
ALTER TABLE "TreasuryEntry" ADD CONSTRAINT "TreasuryEntry_intendedBankAccountId_fkey" FOREIGN KEY ("intendedBankAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
