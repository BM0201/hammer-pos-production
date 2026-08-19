CREATE TYPE "BrainDecisionStatus" AS ENUM ('OPEN', 'APPROVED', 'EXECUTED', 'DISMISSED', 'SNOOZED', 'EXPIRED', 'FAILED');

CREATE TYPE "BrainDecisionCategory" AS ENUM ('INVENTORY', 'REORDER', 'PRICING', 'CASH', 'SALES', 'DISPATCH', 'PRODUCTION', 'SECURITY', 'AUDIT');

CREATE TYPE "BrainDecisionSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

CREATE TABLE "BrainDecision" (
    "id" TEXT NOT NULL,
    "category" "BrainDecisionCategory" NOT NULL,
    "severity" "BrainDecisionSeverity" NOT NULL,
    "status" "BrainDecisionStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "branchId" TEXT,
    "productId" TEXT,
    "userId" TEXT,
    "confidenceScore" DECIMAL(65,30),
    "impactAmount" DECIMAL(65,30),
    "riskScore" DECIMAL(65,30),
    "proposedActionType" TEXT,
    "proposedActionJson" JSONB,
    "evidenceJson" JSONB,
    "sourceJson" JSONB,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,

    CONSTRAINT "BrainDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrainDecisionActionLog" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrainDecisionActionLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrainDecision_fingerprint_key" ON "BrainDecision"("fingerprint");
CREATE INDEX "BrainDecision_status_severity_category_idx" ON "BrainDecision"("status", "severity", "category");
CREATE INDEX "BrainDecision_branchId_idx" ON "BrainDecision"("branchId");
CREATE INDEX "BrainDecision_productId_idx" ON "BrainDecision"("productId");
CREATE INDEX "BrainDecision_fingerprint_idx" ON "BrainDecision"("fingerprint");
CREATE INDEX "BrainDecisionActionLog_decisionId_idx" ON "BrainDecisionActionLog"("decisionId");
CREATE INDEX "BrainDecisionActionLog_actorUserId_idx" ON "BrainDecisionActionLog"("actorUserId");

ALTER TABLE "BrainDecision" ADD CONSTRAINT "BrainDecision_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrainDecision" ADD CONSTRAINT "BrainDecision_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrainDecision" ADD CONSTRAINT "BrainDecision_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrainDecisionActionLog" ADD CONSTRAINT "BrainDecisionActionLog_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "BrainDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrainDecisionActionLog" ADD CONSTRAINT "BrainDecisionActionLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
