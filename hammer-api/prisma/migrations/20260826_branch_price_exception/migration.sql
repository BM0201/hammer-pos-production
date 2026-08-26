-- AlterTable
ALTER TABLE "BranchProductSetting"
ADD COLUMN "priceExceptionReason" TEXT,
ADD COLUMN "priceExceptionAt" TIMESTAMP(3);
