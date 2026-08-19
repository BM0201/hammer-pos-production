ALTER TABLE "InventoryImportBatch"
  ADD COLUMN IF NOT EXISTS "rawJson" JSONB;

ALTER TABLE "InventoryImportLine"
  ADD COLUMN IF NOT EXISTS "rawJson" JSONB;

ALTER TABLE "InventoryImportBatch"
  ALTER COLUMN "status" SET DEFAULT 'PREVIEWED';

UPDATE "InventoryImportBatch"
SET "status" = 'PREVIEWED'
WHERE "status" = 'PREVIEW';
