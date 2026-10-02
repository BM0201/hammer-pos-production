-- prompt-produccion-materiales.md Fase 2 — consumo real al cerrar
-- (actualInputs), variancia de materiales/rendimiento, y segunda calidad.
-- Aditiva: ningún lote existente cambia de comportamiento
-- (consumptionMode default STANDARD, standardQuantity/materialVarianceCost/
-- yieldVariancePct/secondGradeProductId nullable).

-- AlterTable
ALTER TABLE "ProductionBatch" ADD COLUMN     "consumptionMode" TEXT NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "materialVarianceCost" DECIMAL(65,30),
ADD COLUMN     "yieldVariancePct" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "ProductionBatchInput" ADD COLUMN     "standardQuantity" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ProductionRecipe" ADD COLUMN     "secondGradeProductId" TEXT;

-- AddForeignKey
ALTER TABLE "ProductionRecipe" ADD CONSTRAINT "ProductionRecipe_secondGradeProductId_fkey" FOREIGN KEY ("secondGradeProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
