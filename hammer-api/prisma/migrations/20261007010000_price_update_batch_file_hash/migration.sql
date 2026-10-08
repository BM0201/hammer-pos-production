-- prompt-carga-precios.md Fase 4 — hash del archivo importado, para avisar
-- (no bloquear) si el mismo archivo ya se subió antes. Aditiva: una
-- columna nueva, nullable, sin tocar filas existentes.

ALTER TABLE "PriceUpdateBatch" ADD COLUMN "fileHash" TEXT;

CREATE INDEX "PriceUpdateBatch_fileHash_idx" ON "PriceUpdateBatch"("fileHash");
