DO $$ BEGIN
  CREATE TYPE "OperationalDayStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "OperationalDay" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "businessDate" TIMESTAMP(3) NOT NULL,
  "status" "OperationalDayStatus" NOT NULL DEFAULT 'OPEN',
  "openedByUserId" TEXT NOT NULL,
  "closedByUserId" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "salesTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "paidOrdersTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "pendingPaymentTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "expectedCashTotal" DECIMAL(65,30),
  "countedCashTotal" DECIMAL(65,30),
  "cashDifferenceTotal" DECIMAL(65,30),
  "openCashSessionsCount" INTEGER NOT NULL DEFAULT 0,
  "autoClosedPendingReviewCount" INTEGER NOT NULL DEFAULT 0,
  "pendingDispatchCount" INTEGER NOT NULL DEFAULT 0,
  "criticalBrainDecisionCount" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "closeChecklistJson" JSONB,
  "summaryJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationalDay_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CashSession" ADD COLUMN IF NOT EXISTS "operationalDayId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "OperationalDay_branchId_businessDate_key" ON "OperationalDay"("branchId", "businessDate");
CREATE INDEX IF NOT EXISTS "OperationalDay_branchId_status_idx" ON "OperationalDay"("branchId", "status");
CREATE INDEX IF NOT EXISTS "OperationalDay_businessDate_idx" ON "OperationalDay"("businessDate");
CREATE INDEX IF NOT EXISTS "OperationalDay_status_idx" ON "OperationalDay"("status");
CREATE INDEX IF NOT EXISTS "CashSession_operationalDayId_idx" ON "CashSession"("operationalDayId");

DO $$ BEGIN
  ALTER TABLE "OperationalDay"
    ADD CONSTRAINT "OperationalDay_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "OperationalDay"
    ADD CONSTRAINT "OperationalDay_openedByUserId_fkey"
    FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "OperationalDay"
    ADD CONSTRAINT "OperationalDay_closedByUserId_fkey"
    FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CashSession"
    ADD CONSTRAINT "CashSession_operationalDayId_fkey"
    FOREIGN KEY ("operationalDayId") REFERENCES "OperationalDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
