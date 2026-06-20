-- AddFields: CreditNote numbering (creditNoteNumber, sequence, branchId, issuedAt)
-- Adds visible human-readable numbering to CreditNote records.
-- Existing rows (if any in dev) receive placeholder values before constraints are applied.

-- 1. Add nullable columns first to avoid NOT NULL violations on existing rows.
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "creditNoteNumber" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "sequence"         INTEGER;
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "branchId"         TEXT;
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "issuedAt"         TIMESTAMP(3);

-- 2. Back-fill existing rows using createdAt as issuedAt and a placeholder number.
--    In production this table should be empty at the time of migration;
--    in dev it may have test data from the previous migration.
UPDATE "CreditNote"
SET
  "issuedAt"         = "createdAt",
  "branchId"         = (SELECT b.id FROM "Branch" b LIMIT 1),
  "sequence"         = EXTRACT(EPOCH FROM "createdAt")::BIGINT % 1000000,
  "creditNoteNumber" = 'NC-LEGACY-' || SUBSTR("id", 1, 8)
WHERE "creditNoteNumber" IS NULL;

-- 3. Apply NOT NULL constraints now that all rows have values.
ALTER TABLE "CreditNote" ALTER COLUMN "creditNoteNumber" SET NOT NULL;
ALTER TABLE "CreditNote" ALTER COLUMN "sequence"         SET NOT NULL;
ALTER TABLE "CreditNote" ALTER COLUMN "branchId"         SET NOT NULL;
ALTER TABLE "CreditNote" ALTER COLUMN "issuedAt"         SET NOT NULL;

-- 4. Unique and composite constraints.
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_creditNoteNumber_key" UNIQUE ("creditNoteNumber");
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_branchId_sequence_key" UNIQUE ("branchId", "sequence");

-- 5. Foreign key to Branch.
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Index for branch+status queries.
CREATE INDEX IF NOT EXISTS "CreditNote_branchId_status_idx" ON "CreditNote"("branchId", "status");
