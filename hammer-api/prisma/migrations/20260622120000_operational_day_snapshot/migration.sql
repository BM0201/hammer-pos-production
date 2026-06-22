ALTER TABLE "OperationalDay"
  ADD COLUMN IF NOT EXISTS "closeSummaryJson" JSONB,
  ADD COLUMN IF NOT EXISTS "approvalSummaryJson" JSONB;
