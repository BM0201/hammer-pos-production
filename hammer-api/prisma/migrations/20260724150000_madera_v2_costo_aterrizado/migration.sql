-- Madera v2: el viaje como única fuente del costo aterrizado (gastos +
-- conciliación + política de precio) y configuración de cubicación/precios/
-- margen como datos. Todo aditivo — ningún campo ni tabla existente se
-- modifica de forma destructiva; los valores DEFAULT preservan el
-- comportamiento actual para viajes ya confirmados.

-- AlterTable
ALTER TABLE "TimberTrip"
  ADD COLUMN "freightAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "fuelAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "perDiemAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "permitsAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "otherExpensesAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "tripExpensesTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "landedCostPerFoot" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN "invoicedFeet" DECIMAL(65,30),
  ADD COLUMN "pricePolicy" TEXT NOT NULL DEFAULT 'RECALC_FROM_PRICE_PER_INCH',
  ADD COLUMN "marginOverrideReason" TEXT,
  ADD COLUMN "reconciliationAcknowledged" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TimberPricingConfig"
  ADD COLUMN "cubicationTable" JSONB,
  ADD COLUMN "tablaWidths" JSONB,
  ADD COLUMN "tablillaWidths" JSONB,
  ADD COLUMN "targetMarginPercent" DECIMAL(65,30) NOT NULL DEFAULT 0.40,
  ADD COLUMN "reconciliationTolerancePercent" DECIMAL(65,30) NOT NULL DEFAULT 0.01,
  ADD COLUMN "warnBelowTargetMargin" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "blockNegativeMargin" BOOLEAN NOT NULL DEFAULT true;
