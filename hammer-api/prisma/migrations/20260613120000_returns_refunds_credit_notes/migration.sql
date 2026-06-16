-- CreateEnum
CREATE TYPE "SaleCancellationStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'EXECUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SaleReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'EXECUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SaleReturnType" AS ENUM ('PARTIAL', 'TOTAL');

-- CreateEnum
CREATE TYPE "ReturnedItemCondition" AS ENUM ('GOOD', 'DAMAGED', 'NOT_RETURNED');

-- CreateEnum
CREATE TYPE "ReturnInventoryDestination" AS ENUM ('SELLABLE', 'DAMAGED', 'NONE');

-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'CREDIT_NOTE', 'MIXED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'APPROVED', 'AVAILABLE', 'PARTIALLY_USED', 'USED', 'VOIDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CustomerRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'BLOCKED');

-- CreateEnum
CREATE TYPE "InventoryCondition" AS ENUM ('SELLABLE', 'DAMAGED');

-- AlterEnum
ALTER TYPE "InventoryMovementType" ADD VALUE 'RETURN_IN_DAMAGED';

-- AlterTable
ALTER TABLE "OperationalDay"
ADD COLUMN "approvedByMasterId" TEXT,
ADD COLUMN "approvedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "InventoryConditionBalance" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "condition" "InventoryCondition" NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryConditionBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleCancellation" (
    "id" TEXT NOT NULL,
    "saleOrderId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "operationalDayId" TEXT,
    "approvalRequestId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "approvedByMasterId" TEXT,
    "status" "SaleCancellationStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "hadTransport" BOOLEAN NOT NULL DEFAULT false,
    "transportWasExecuted" BOOLEAN NOT NULL DEFAULT false,
    "replacementSaleOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "SaleCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturn" (
    "id" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "saleOrderId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT,
    "operationalDayId" TEXT,
    "approvalRequestId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "approvedByMasterId" TEXT,
    "status" "SaleReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "returnType" "SaleReturnType" NOT NULL,
    "reason" TEXT NOT NULL,
    "affectsClosedOperationalDay" BOOLEAN NOT NULL DEFAULT false,
    "requiresMasterApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturnItem" (
    "id" TEXT NOT NULL,
    "saleReturnId" TEXT NOT NULL,
    "saleOrderLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitPricePaid" DECIMAL(65,30) NOT NULL,
    "discountAllocated" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "refundableAmount" DECIMAL(65,30) NOT NULL,
    "condition" "ReturnedItemCondition" NOT NULL,
    "inventoryDestination" "ReturnInventoryDestination" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "saleReturnId" TEXT,
    "saleCancellationId" TEXT,
    "paymentId" TEXT,
    "cashSessionId" TEXT,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT,
    "method" "RefundMethod" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "postedByUserId" TEXT,
    "approvedByMasterId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "saleOrderId" TEXT,
    "saleReturnId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "availableAmount" DECIMAL(65,30) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT NOT NULL,
    "approvedByMasterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCreditScore" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "riskLevel" "CustomerRiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "totalPurchases" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalReturns" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "returnRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "unpaidBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "latePaymentsCount" INTEGER NOT NULL DEFAULT 0,
    "creditNotesIssued" INTEGER NOT NULL DEFAULT 0,
    "manualInvoicesCount" INTEGER NOT NULL DEFAULT 0,
    "lastReviewAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCreditScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryConditionBalance_branch_product_condition_key" ON "InventoryConditionBalance"("branchId", "productId", "condition");

-- CreateIndex
CREATE INDEX "InventoryConditionBalance_branch_condition_idx" ON "InventoryConditionBalance"("branchId", "condition");

-- CreateIndex
CREATE INDEX "InventoryConditionBalance_product_condition_idx" ON "InventoryConditionBalance"("productId", "condition");

-- CreateIndex
CREATE UNIQUE INDEX "SaleCancellation_approvalRequestId_key" ON "SaleCancellation"("approvalRequestId");

-- CreateIndex
CREATE INDEX "SaleCancellation_saleOrderId_idx" ON "SaleCancellation"("saleOrderId");

-- CreateIndex
CREATE INDEX "SaleCancellation_branch_status_idx" ON "SaleCancellation"("branchId", "status");

-- CreateIndex
CREATE INDEX "SaleCancellation_operationalDayId_idx" ON "SaleCancellation"("operationalDayId");

-- CreateIndex
CREATE INDEX "SaleCancellation_requestedByUserId_idx" ON "SaleCancellation"("requestedByUserId");

-- CreateIndex
CREATE INDEX "SaleCancellation_approvedByMasterId_idx" ON "SaleCancellation"("approvedByMasterId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturn_returnNumber_key" ON "SaleReturn"("returnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturn_approvalRequestId_key" ON "SaleReturn"("approvalRequestId");

-- CreateIndex
CREATE INDEX "SaleReturn_saleOrderId_idx" ON "SaleReturn"("saleOrderId");

-- CreateIndex
CREATE INDEX "SaleReturn_branch_status_idx" ON "SaleReturn"("branchId", "status");

-- CreateIndex
CREATE INDEX "SaleReturn_customerId_idx" ON "SaleReturn"("customerId");

-- CreateIndex
CREATE INDEX "SaleReturn_operationalDayId_idx" ON "SaleReturn"("operationalDayId");

-- CreateIndex
CREATE INDEX "SaleReturn_requestedByUserId_idx" ON "SaleReturn"("requestedByUserId");

-- CreateIndex
CREATE INDEX "SaleReturn_approvedByMasterId_idx" ON "SaleReturn"("approvedByMasterId");

-- CreateIndex
CREATE INDEX "SaleReturnItem_saleReturnId_idx" ON "SaleReturnItem"("saleReturnId");

-- CreateIndex
CREATE INDEX "SaleReturnItem_saleOrderLineId_idx" ON "SaleReturnItem"("saleOrderLineId");

-- CreateIndex
CREATE INDEX "SaleReturnItem_productId_idx" ON "SaleReturnItem"("productId");

-- CreateIndex
CREATE INDEX "SaleReturnItem_condition_destination_idx" ON "SaleReturnItem"("condition", "inventoryDestination");

-- CreateIndex
CREATE INDEX "Refund_saleReturnId_idx" ON "Refund"("saleReturnId");

-- CreateIndex
CREATE INDEX "Refund_saleCancellationId_idx" ON "Refund"("saleCancellationId");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- CreateIndex
CREATE INDEX "Refund_cashSessionId_idx" ON "Refund"("cashSessionId");

-- CreateIndex
CREATE INDEX "Refund_branch_status_idx" ON "Refund"("branchId", "status");

-- CreateIndex
CREATE INDEX "Refund_customerId_idx" ON "Refund"("customerId");

-- CreateIndex
CREATE INDEX "CreditNote_customer_status_idx" ON "CreditNote"("customerId", "status");

-- CreateIndex
CREATE INDEX "CreditNote_saleOrderId_idx" ON "CreditNote"("saleOrderId");

-- CreateIndex
CREATE INDEX "CreditNote_saleReturnId_idx" ON "CreditNote"("saleReturnId");

-- CreateIndex
CREATE INDEX "CreditNote_createdByUserId_idx" ON "CreditNote"("createdByUserId");

-- CreateIndex
CREATE INDEX "CreditNote_approvedByMasterId_idx" ON "CreditNote"("approvedByMasterId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCreditScore_customerId_key" ON "CustomerCreditScore"("customerId");

-- CreateIndex
CREATE INDEX "CustomerCreditScore_riskLevel_idx" ON "CustomerCreditScore"("riskLevel");

-- CreateIndex
CREATE INDEX "CustomerCreditScore_updatedAt_idx" ON "CustomerCreditScore"("updatedAt");

-- CreateIndex
CREATE INDEX "OperationalDay_approvedByMasterId_idx" ON "OperationalDay"("approvedByMasterId");

-- AddForeignKey
ALTER TABLE "OperationalDay" ADD CONSTRAINT "OperationalDay_approvedByMasterId_fkey" FOREIGN KEY ("approvedByMasterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryConditionBalance" ADD CONSTRAINT "InventoryConditionBalance_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryConditionBalance" ADD CONSTRAINT "InventoryConditionBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleCancellation" ADD CONSTRAINT "SaleCancellation_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "SaleOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleCancellation" ADD CONSTRAINT "SaleCancellation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleCancellation" ADD CONSTRAINT "SaleCancellation_operationalDayId_fkey" FOREIGN KEY ("operationalDayId") REFERENCES "OperationalDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleCancellation" ADD CONSTRAINT "SaleCancellation_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleCancellation" ADD CONSTRAINT "SaleCancellation_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleCancellation" ADD CONSTRAINT "SaleCancellation_approvedByMasterId_fkey" FOREIGN KEY ("approvedByMasterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleCancellation" ADD CONSTRAINT "SaleCancellation_replacementSaleOrderId_fkey" FOREIGN KEY ("replacementSaleOrderId") REFERENCES "SaleOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "SaleOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_operationalDayId_fkey" FOREIGN KEY ("operationalDayId") REFERENCES "OperationalDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_approvedByMasterId_fkey" FOREIGN KEY ("approvedByMasterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_saleOrderLineId_fkey" FOREIGN KEY ("saleOrderLineId") REFERENCES "SaleOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_saleCancellationId_fkey" FOREIGN KEY ("saleCancellationId") REFERENCES "SaleCancellation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvedByMasterId_fkey" FOREIGN KEY ("approvedByMasterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "SaleOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_approvedByMasterId_fkey" FOREIGN KEY ("approvedByMasterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditScore" ADD CONSTRAINT "CustomerCreditScore_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
