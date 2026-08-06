ALTER TYPE "BrainDecisionStatus" ADD VALUE IF NOT EXISTS 'MANUAL_REVIEW';

ALTER TABLE "BrainDecision"
ADD COLUMN "executedEntityType" TEXT,
ADD COLUMN "executedEntityId" TEXT,
ADD COLUMN "actionResultJson" JSONB;

ALTER TABLE "BrainDecision"
ADD CONSTRAINT "BrainDecision_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
