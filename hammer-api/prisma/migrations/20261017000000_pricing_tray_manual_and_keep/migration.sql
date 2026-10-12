-- prompt-completo-pendientes-2026-10.md Parte C.1.2 — "mantener el precio
-- actual" desde la Bandeja. Foto del precio/costo vigentes al momento de
-- la revisión, para que el detector no reabra la misma decisión mientras
-- el costo no se mueva más de la tolerancia configurada.
ALTER TABLE "BranchProductSetting" ADD COLUMN "priceReviewedAt" TIMESTAMP(3);
ALTER TABLE "BranchProductSetting" ADD COLUMN "priceReviewedPrice" DECIMAL(65,30);
ALTER TABLE "BranchProductSetting" ADD COLUMN "priceReviewedCost" DECIMAL(65,30);
ALTER TABLE "BranchProductSetting" ADD COLUMN "priceReviewedByUserId" TEXT;
ALTER TABLE "BranchProductSetting" ADD COLUMN "priceReviewNote" TEXT;
