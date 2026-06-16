ALTER TYPE "BrainDecisionStatus" ADD VALUE IF NOT EXISTS 'EXECUTING';
ALTER TYPE "BrainDecisionCategory" ADD VALUE IF NOT EXISTS 'PURCHASING';
ALTER TYPE "BrainDecisionCategory" ADD VALUE IF NOT EXISTS 'SYSTEM';

ALTER TABLE "BrainDecision"
  ADD COLUMN IF NOT EXISTS "targetUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "priorityScore" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "BrainDecision"
SET "targetUserId" = COALESCE("targetUserId", "userId")
WHERE "targetUserId" IS NULL AND "userId" IS NOT NULL;

UPDATE "BrainDecision"
SET "priorityScore" = COALESCE("priorityScore", "riskScore", 0),
    "firstDetectedAt" = COALESCE("firstDetectedAt", "createdAt"),
    "lastDetectedAt" = COALESCE("lastDetectedAt", "createdAt"),
    "updatedAt" = COALESCE("updatedAt", "createdAt");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BrainDecision_userId_fkey'
  ) THEN
    ALTER TABLE "BrainDecision" DROP CONSTRAINT "BrainDecision_userId_fkey";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BrainDecision_userId_fkey'
  ) THEN
    ALTER TABLE "BrainDecision"
      ADD CONSTRAINT "BrainDecision_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BrainDecision_targetUserId_fkey'
  ) THEN
    ALTER TABLE "BrainDecision"
      ADD CONSTRAINT "BrainDecision_targetUserId_fkey"
      FOREIGN KEY ("targetUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "BrainDecisionActionLog"
  ALTER COLUMN "actorUserId" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "BrainDecision_idempotencyKey_key"
  ON "BrainDecision"("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "BrainDecision_targetUserId_idx" ON "BrainDecision"("targetUserId");
CREATE INDEX IF NOT EXISTS "BrainDecision_createdAt_idx" ON "BrainDecision"("createdAt");
CREATE INDEX IF NOT EXISTS "BrainDecision_priorityScore_idx" ON "BrainDecision"("priorityScore");

CREATE TABLE IF NOT EXISTS "BrainDecisionOutcome" (
  "id" TEXT NOT NULL,
  "decisionId" TEXT NOT NULL,
  "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "outcomeType" TEXT NOT NULL,
  "expectedImpact" DECIMAL(65,30),
  "actualImpact" DECIMAL(65,30),
  "successScore" DECIMAL(65,30),
  "notes" TEXT,
  "metadataJson" JSONB,
  CONSTRAINT "BrainDecisionOutcome_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BrainDecisionOutcome_decisionId_fkey'
  ) THEN
    ALTER TABLE "BrainDecisionOutcome"
      ADD CONSTRAINT "BrainDecisionOutcome_decisionId_fkey"
      FOREIGN KEY ("decisionId") REFERENCES "BrainDecision"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "BrainDecisionOutcome_decisionId_idx" ON "BrainDecisionOutcome"("decisionId");
CREATE INDEX IF NOT EXISTS "BrainDecisionOutcome_outcomeType_idx" ON "BrainDecisionOutcome"("outcomeType");
CREATE INDEX IF NOT EXISTS "BrainDecisionOutcome_measuredAt_idx" ON "BrainDecisionOutcome"("measuredAt");
