-- AlterTable
ALTER TABLE "TreasuryEntry" ADD COLUMN "intendedRecipientUserId" TEXT;

-- CreateIndex
CREATE INDEX "TreasuryEntry_intendedRecipientUserId_idx" ON "TreasuryEntry"("intendedRecipientUserId");

-- AddForeignKey
ALTER TABLE "TreasuryEntry" ADD CONSTRAINT "TreasuryEntry_intendedRecipientUserId_fkey" FOREIGN KEY ("intendedRecipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
