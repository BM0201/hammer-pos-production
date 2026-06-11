-- Package/loose-unit stock tracking for shared inventory presentations.
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'PACKAGE_IN';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'PACKAGE_SALE_OUT';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'PACKAGE_OPENED';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'LOOSE_UNIT_SALE_OUT';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'LOOSE_UNIT_RETURN_IN';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'LOOSE_ADJUSTMENT';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'PACKAGE_ADJUSTMENT';

ALTER TABLE "ProductStockGroup"
  ADD COLUMN IF NOT EXISTS "packageUnit" TEXT,
  ADD COLUMN IF NOT EXISTS "conversionFactorToBase" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "tracksPackages" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "approximateFactor" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ProductStockGroupMember"
  ADD COLUMN IF NOT EXISTS "isPackagePresentation" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ProductStockGroupMember"
SET "isPackagePresentation" = true
WHERE "isCanonical" = false AND "isPackagePresentation" = false;

ALTER TABLE "InventoryBalance"
  ADD COLUMN IF NOT EXISTS "closedPackageQuantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "looseUnitQuantity" DECIMAL(65,30) NOT NULL DEFAULT 0;

ALTER TABLE "InventoryMovement"
  ADD COLUMN IF NOT EXISTS "inputProductId" TEXT,
  ADD COLUMN IF NOT EXISTS "inputQuantity" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "inputUnit" TEXT,
  ADD COLUMN IF NOT EXISTS "packageUnit" TEXT,
  ADD COLUMN IF NOT EXISTS "baseUnit" TEXT,
  ADD COLUMN IF NOT EXISTS "conversionFactorSnapshot" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "estimatedUnits" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "actualUnits" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "closedPackageBefore" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "closedPackageAfter" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "looseUnitBefore" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "looseUnitAfter" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "equivalentBaseBefore" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "equivalentBaseAfter" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "reason" TEXT,
  ADD COLUMN IF NOT EXISTS "userId" TEXT;
