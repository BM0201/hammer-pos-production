-- Extend existing print settings with operational document preferences.
ALTER TABLE "PrintSettings"
  ADD COLUMN "cashRegisterId" TEXT,
  ADD COLUMN "name" TEXT NOT NULL DEFAULT 'Configuracion principal',
  ADD COLUMN "autoPrintDelivery" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "copiesDeliveryOrder" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "businessName" TEXT,
  ADD COLUMN "businessLegalName" TEXT,
  ADD COLUMN "taxId" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "showPricesOnDeliveryOrder" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "showCostData" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "showCashierName" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "showCustomerData" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "ticketTemplate" TEXT,
  ADD COLUMN "deliveryTemplate" TEXT,
  ADD COLUMN "receiptTemplate" TEXT,
  ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "PrintSettings_branchId_isActive_idx" ON "PrintSettings"("branchId", "isActive");
