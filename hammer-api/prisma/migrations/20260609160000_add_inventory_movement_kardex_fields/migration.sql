-- Kardex enrichment fields for InventoryMovement
-- Adds the columns that the Kardex UI already renders (USUARIO / SALDO FINAL / UNIDAD).
-- All columns are nullable so historical rows remain valid without a backfill.

ALTER TABLE "InventoryMovement"
  ADD COLUMN "balanceAfter" DECIMAL(65, 30),
  ADD COLUMN "actorUserId" TEXT,
  ADD COLUMN "unit" TEXT;

-- Index to filter/lookup movements by the acting user.
CREATE INDEX "InventoryMovement_actorUserId_idx" ON "InventoryMovement"("actorUserId");

-- Optional FK to User (nullable: historical movements keep NULL actor).
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
