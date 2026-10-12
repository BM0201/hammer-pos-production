-- Parte B.2 (prompt-completo-pendientes-2026-10.md) — ingreso y traslado a
-- varias sucursales a la vez.

CREATE TYPE "MultiBranchIntakeKind" AS ENUM ('OPENING_BALANCE', 'ADJUSTMENT_IN');
CREATE TYPE "MultiBranchIntakeBranchStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

CREATE TABLE "MultiBranchIntake" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "kind" "MultiBranchIntakeKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "linesJson" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultiBranchIntake_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MultiBranchIntake_code_key" ON "MultiBranchIntake"("code");
CREATE UNIQUE INDEX "MultiBranchIntake_sequence_key" ON "MultiBranchIntake"("sequence");
CREATE UNIQUE INDEX "MultiBranchIntake_clientRequestId_key" ON "MultiBranchIntake"("clientRequestId");

ALTER TABLE "MultiBranchIntake" ADD CONSTRAINT "MultiBranchIntake_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MultiBranchIntakeBranch" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" "MultiBranchIntakeBranchStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "MultiBranchIntakeBranch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MultiBranchIntakeBranch_intakeId_branchId_key" ON "MultiBranchIntakeBranch"("intakeId", "branchId");
CREATE INDEX "MultiBranchIntakeBranch_status_idx" ON "MultiBranchIntakeBranch"("status");

ALTER TABLE "MultiBranchIntakeBranch" ADD CONSTRAINT "MultiBranchIntakeBranch_intakeId_fkey"
  FOREIGN KEY ("intakeId") REFERENCES "MultiBranchIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MultiBranchIntakeBranch" ADD CONSTRAINT "MultiBranchIntakeBranch_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TransferGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "fromBranchId" TEXT NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransferGroup_code_key" ON "TransferGroup"("code");
CREATE UNIQUE INDEX "TransferGroup_sequence_key" ON "TransferGroup"("sequence");
CREATE UNIQUE INDEX "TransferGroup_clientRequestId_key" ON "TransferGroup"("clientRequestId");

ALTER TABLE "TransferGroup" ADD CONSTRAINT "TransferGroup_fromBranchId_fkey"
  FOREIGN KEY ("fromBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransferGroup" ADD CONSTRAINT "TransferGroup_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Transfer" ADD COLUMN "groupId" TEXT;
CREATE INDEX "Transfer_groupId_idx" ON "Transfer"("groupId");
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "TransferGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
