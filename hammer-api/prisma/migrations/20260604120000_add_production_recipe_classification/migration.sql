ALTER TABLE "ProductionRecipe"
  ADD COLUMN "recipeType" TEXT NOT NULL DEFAULT 'MANUFACTURING',
  ADD COLUMN "recipeFamily" TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "yieldPercent" DOUBLE PRECISION,
  ADD COLUMN "wastePercent" DOUBLE PRECISION,
  ADD COLUMN "processingCostPerBatch" DOUBLE PRECISION,
  ADD COLUMN "laborCostPerBatch" DOUBLE PRECISION;

CREATE INDEX "ProductionRecipe_recipeType_idx" ON "ProductionRecipe"("recipeType");
CREATE INDEX "ProductionRecipe_recipeFamily_idx" ON "ProductionRecipe"("recipeFamily");
