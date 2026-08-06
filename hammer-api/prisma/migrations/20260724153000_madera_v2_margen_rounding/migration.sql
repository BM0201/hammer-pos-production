-- Madera v2 Fase 2/3: múltiplo de redondeo (hacia ARRIBA, no al más cercano)
-- para la política de precio TARGET_MARGIN — garantiza que el precio final
-- nunca quede por debajo del margen objetivo por efecto del redondeo.

-- AlterTable
ALTER TABLE "TimberPricingConfig"
  ADD COLUMN "targetMarginRoundingMultiple" DECIMAL(65,30) NOT NULL DEFAULT 1;
