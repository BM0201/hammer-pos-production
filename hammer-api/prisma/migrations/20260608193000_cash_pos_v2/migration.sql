CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "PaymentWorkflowMode" AS ENUM ('QUEUE_ONLY', 'DIRECT_ONLY', 'HYBRID');
CREATE TYPE "DispatchWorkflowMode" AS ENUM ('DISABLED', 'ENABLED');
CREATE TYPE "CashSessionOperatorRole" AS ENUM ('OWNER_OPERATOR', 'CASHIER_OPERATOR', 'SALES_DIRECT_OPERATOR', 'SUPERVISOR_OPERATOR');
CREATE TYPE "CashMovementType" AS ENUM ('CASH_IN', 'CASH_OUT', 'CHANGE_IN', 'BANK_DEPOSIT_OUT', 'EXPENSE_OUT', 'REFUND_OUT', 'CORRECTION');

ALTER TABLE "BranchModuleConfig"
  ADD COLUMN "paymentWorkflowMode" "PaymentWorkflowMode" NOT NULL DEFAULT 'HYBRID',
  ADD COLUMN "dispatchWorkflowMode" "DispatchWorkflowMode" NOT NULL DEFAULT 'ENABLED',
  ADD COLUMN "requireOpenCashSessionForDirectSale" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowSellerDirectPayment" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowCashierQueue" BOOLEAN NOT NULL DEFAULT true;

UPDATE "BranchModuleConfig"
SET
  "paymentWorkflowMode" = CASE
    WHEN "enableCashier" = true THEN 'HYBRID'::"PaymentWorkflowMode"
    ELSE 'DIRECT_ONLY'::"PaymentWorkflowMode"
  END,
  "dispatchWorkflowMode" = CASE
    WHEN "enableDispatch" = true THEN 'ENABLED'::"DispatchWorkflowMode"
    ELSE 'DISABLED'::"DispatchWorkflowMode"
  END,
  "allowCashierQueue" = "enableCashier",
  "allowSellerDirectPayment" = true,
  "requireOpenCashSessionForDirectSale" = true;

CREATE TABLE "CashSessionOperator" (
  "id" TEXT NOT NULL,
  "cashSessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "operatorRole" "CashSessionOperatorRole" NOT NULL,
  "assignedByUserId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,

  CONSTRAINT "CashSessionOperator_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashSessionOperator_cashSessionId_userId_key" ON "CashSessionOperator"("cashSessionId", "userId");
CREATE INDEX "CashSessionOperator_cashSessionId_isActive_idx" ON "CashSessionOperator"("cashSessionId", "isActive");
CREATE INDEX "CashSessionOperator_userId_isActive_idx" ON "CashSessionOperator"("userId", "isActive");

ALTER TABLE "CashSessionOperator"
  ADD CONSTRAINT "CashSessionOperator_cashSessionId_fkey"
    FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CashSessionOperator_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CashSessionOperator_assignedByUserId_fkey"
    FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "CashSessionOperator" ("id", "cashSessionId", "userId", "operatorRole", "assignedByUserId", "assignedAt", "isActive")
SELECT
  concat('cso_', gen_random_uuid()::text),
  "id",
  "openedByUserId",
  'OWNER_OPERATOR'::"CashSessionOperatorRole",
  "openedByUserId",
  "openedAt",
  CASE WHEN "status" IN ('OPEN', 'RECONCILING') THEN true ELSE false END
FROM "CashSession"
ON CONFLICT ("cashSessionId", "userId") DO NOTHING;

CREATE TABLE "CashMovement" (
  "id" TEXT NOT NULL,
  "cashSessionId" TEXT NOT NULL,
  "type" "CashMovementType" NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CashMovement_cashSessionId_createdAt_idx" ON "CashMovement"("cashSessionId", "createdAt");
CREATE INDEX "CashMovement_type_idx" ON "CashMovement"("type");

ALTER TABLE "CashMovement"
  ADD CONSTRAINT "CashMovement_cashSessionId_fkey"
    FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CashMovement_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CashMovement_approvedByUserId_fkey"
    FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PaymentTender" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "receivedAmount" DECIMAL(65,30),
  "changeAmount" DECIMAL(65,30),
  "referenceNumber" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentTender_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentTender_paymentId_idx" ON "PaymentTender"("paymentId");
CREATE INDEX "PaymentTender_method_idx" ON "PaymentTender"("method");

ALTER TABLE "PaymentTender"
  ADD CONSTRAINT "PaymentTender_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PaymentTender" ("id", "paymentId", "method", "amount", "referenceNumber", "createdAt")
SELECT concat('pt_', gen_random_uuid()::text), "id", "method", "amount", "referenceNumber", "createdAt"
FROM "Payment"
WHERE "status" = 'POSTED'
ON CONFLICT DO NOTHING;
