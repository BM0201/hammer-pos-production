-- Producción de Materiales v2.
--
-- Fase 0 (bloqueante): migra todos los campos de dinero de Float a Decimal
-- (mismo tipo sin precisión nativa que usa el resto del proyecto — ver
-- SaleOrder.grandTotal, TimberTrip.totalCost, etc.). El cast float8::decimal
-- preserva el valor exacto que ya tenía cada fila — no hay migración de
-- datos con pérdida, cada float tiene una representación decimal exacta.
--
-- Fase 1/3/4/5: campos aditivos para costeo estándar (labor/overhead
-- desactivados por defecto), política de precio al cerrar, reversión de
-- lotes completados, variancia estándar-vs-real, y reserva de insumos al
-- planificar. Todo aditivo — ningún campo ni tabla existente se borra.

-- ProductionRecipe: Float -> Decimal
ALTER TABLE "ProductionRecipe"
  ALTER COLUMN "targetMarginPct" TYPE DECIMAL(65,30) USING "targetMarginPct"::decimal,
  ALTER COLUMN "yieldPercent" TYPE DECIMAL(65,30) USING "yieldPercent"::decimal,
  ALTER COLUMN "wastePercent" TYPE DECIMAL(65,30) USING "wastePercent"::decimal,
  ALTER COLUMN "processingCostPerBatch" TYPE DECIMAL(65,30) USING "processingCostPerBatch"::decimal,
  ALTER COLUMN "laborCostPerBatch" TYPE DECIMAL(65,30) USING "laborCostPerBatch"::decimal;

-- ProductionRecipe: nuevos campos Fase 1 (labor/overhead, desactivados por defecto)
ALTER TABLE "ProductionRecipe"
  ADD COLUMN "laborEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "overheadMode" TEXT NOT NULL DEFAULT 'NONE';

-- ProductionBatch: Float -> Decimal
ALTER TABLE "ProductionBatch"
  ALTER COLUMN "materialsCost" TYPE DECIMAL(65,30) USING "materialsCost"::decimal,
  ALTER COLUMN "laborCost" TYPE DECIMAL(65,30) USING "laborCost"::decimal,
  ALTER COLUMN "overheadCost" TYPE DECIMAL(65,30) USING "overheadCost"::decimal,
  ALTER COLUMN "totalCost" TYPE DECIMAL(65,30) USING "totalCost"::decimal,
  ALTER COLUMN "unitCost" TYPE DECIMAL(65,30) USING "unitCost"::decimal,
  ALTER COLUMN "suggestedPrice" TYPE DECIMAL(65,30) USING "suggestedPrice"::decimal;

-- ProductionBatch: nuevos campos Fase 3 (política de precio), Fase 4 (reversión),
-- Fase 5 (costo estándar congelado) y Fase 1 (registro informativo de mano de obra)
ALTER TABLE "ProductionBatch"
  ADD COLUMN "standardUnitCost" DECIMAL(65,30),
  ADD COLUMN "standardMaterialsCost" DECIMAL(65,30),
  ADD COLUMN "pricePolicy" TEXT NOT NULL DEFAULT 'RECALC_TARGET_MARGIN',
  ADD COLUMN "priceApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "laborEntries" JSONB,
  ADD COLUMN "reversedAt" TIMESTAMP(3),
  ADD COLUMN "reversedByUserId" TEXT,
  ADD COLUMN "reversalReason" TEXT;

-- ProductionBatchInput: Float -> Decimal
ALTER TABLE "ProductionBatchInput"
  ALTER COLUMN "unitCost" TYPE DECIMAL(65,30) USING "unitCost"::decimal,
  ALTER COLUMN "totalCost" TYPE DECIMAL(65,30) USING "totalCost"::decimal;

-- ProductionBatchInput: reserva de insumos (Fase 2)
ALTER TABLE "ProductionBatchInput"
  ADD COLUMN "reservedQuantity" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- ProductionBatchStatus: nuevo valor REVERSED (Fase 4)
ALTER TYPE "ProductionBatchStatus" ADD VALUE 'REVERSED';

-- InventoryMovementType: movimientos inversos de una reversión de lote (Fase 4)
ALTER TYPE "InventoryMovementType" ADD VALUE 'PRODUCTION_REVERSAL_IN';
ALTER TYPE "InventoryMovementType" ADD VALUE 'PRODUCTION_REVERSAL_OUT';

-- ProductionPricingConfig: configuración global (Fase 3) — política de precio y redondeo.
CREATE TABLE "ProductionPricingConfig" (
    "id" TEXT NOT NULL,
    "defaultTargetMarginPct" DECIMAL(65,30) NOT NULL DEFAULT 0.30,
    "priceApprovalDeltaPct" DECIMAL(65,30) NOT NULL DEFAULT 0.15,
    "priceRoundingMultiple" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionPricingConfig_pkey" PRIMARY KEY ("id")
);
