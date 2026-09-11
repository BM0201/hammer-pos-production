-- AlterTable
ALTER TABLE "TimberPricingConfig" ADD COLUMN "branchId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TimberPricingConfig_branchId_key" ON "TimberPricingConfig"("branchId");

-- AddForeignKey
ALTER TABLE "TimberPricingConfig" ADD CONSTRAINT "TimberPricingConfig_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
