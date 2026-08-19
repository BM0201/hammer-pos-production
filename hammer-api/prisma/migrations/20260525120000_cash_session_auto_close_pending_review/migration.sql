ALTER TYPE "CashSessionStatus" ADD VALUE IF NOT EXISTS 'AUTO_CLOSED_PENDING_REVIEW';

ALTER TABLE "CashSession"
  ADD COLUMN IF NOT EXISTS "reviewedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "autoClosedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "autoClosedReason" TEXT,
  ADD COLUMN IF NOT EXISTS "autoClosedBySystem" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "expectedCashAmount" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "countedCashAmount" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "differenceAmount" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "requiresReview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CashSession_reviewedByUserId_fkey'
  ) THEN
    ALTER TABLE "CashSession"
      ADD CONSTRAINT "CashSession_reviewedByUserId_fkey"
      FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CashSession_status_requiresReview_idx"
  ON "CashSession"("status", "requiresReview");
