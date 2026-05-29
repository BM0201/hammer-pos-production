-- AlterTable
ALTER TABLE "PurchaseOrder"
ADD COLUMN "subtotalBeforeTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "freightAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "otherChargesAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "globalDiscountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "purchaseTaxTreatment" TEXT NOT NULL DEFAULT 'INCLUDE_IN_COST';

-- AlterTable
ALTER TABLE "PurchaseOrderLine"
ADD COLUMN "unitCostBeforeTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "taxRate" DECIMAL(65,30) NOT NULL DEFAULT 15,
ADD COLUMN "unitTaxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "costWithTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "allocatedFreightPerUnit" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "allocatedOtherChargesPerUnit" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "allocatedDiscountPerUnit" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "finalUnitCost" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- Backfill existing purchase data as already-final costs.
UPDATE "PurchaseOrderLine"
SET
  "unitCostBeforeTax" = "unitCost",
  "costWithTax" = "unitCost",
  "finalUnitCost" = "unitCost";

UPDATE "PurchaseOrder"
SET "subtotalBeforeTax" = "total";
