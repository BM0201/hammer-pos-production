-- prompt-completo-pendientes-2026-10.md Parte C.3 — "nada fijo en el
-- código": estos 5 campos sacan DEFAULT_POLICY (15/30) y la matriz
-- ABC-XYZ del código fuente y los mueven a configuración por sucursal.
-- Los DEFAULT de la columna copian los valores que antes eran literales
-- en TypeScript, así que ninguna fila existente cambia de comportamiento
-- hasta que el dueño edite su configuración.
ALTER TABLE "PricingConfig" ADD COLUMN "alertMinMarginPercent" DECIMAL(65,30) NOT NULL DEFAULT 15;
ALTER TABLE "PricingConfig" ADD COLUMN "targetMarginPercent" DECIMAL(65,30) NOT NULL DEFAULT 30;
ALTER TABLE "PricingConfig" ADD COLUMN "reviewCostTolerancePercent" DECIMAL(65,30) NOT NULL DEFAULT 3;
ALTER TABLE "PricingConfig" ADD COLUMN "abcXyzAdjustmentEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PricingConfig" ADD COLUMN "abcXyzMarginDeltaJson" JSONB;
