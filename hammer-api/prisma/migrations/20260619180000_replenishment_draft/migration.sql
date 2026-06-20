-- CreateEnum
CREATE TYPE "ReplenishmentDraftStatus" AS ENUM ('DRAFT', 'REVIEWED', 'APPROVED', 'PARTIALLY_APPROVED', 'CONVERTED_TO_TRANSFER', 'CONVERTED_TO_PURCHASE_REQUEST', 'CONVERTED_TO_PRODUCTION_ORDER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReplenishmentDraftItemStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'IGNORED', 'QUANTITY_EDITED', 'TRANSFER_CREATED', 'PURCHASE_REQUEST_CREATED', 'PRODUCTION_ORDER_CREATED', 'MANUAL_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "ReplenishmentDraftSource" AS ENUM ('CENTRAL', 'OTHER_BRANCH', 'SUPPLIER', 'PRODUCTION', 'DO_NOT_REPLENISH', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "ReplenishmentDraftCriticality" AS ENUM ('CRITICAL', 'LOW', 'PREVENTIVE', 'OBSERVE', 'NORMAL', 'DO_NOT_RECOMMEND', 'MANUAL_REVIEW', 'SENSITIVE');

-- CreateTable
CREATE TABLE "ReplenishmentDraft" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "status" "ReplenishmentDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "includePreventive" BOOLEAN NOT NULL DEFAULT false,
    "includeSensitive" BOOLEAN NOT NULL DEFAULT false,
    "categoryId" TEXT,
    "notes" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),

    CONSTRAINT "ReplenishmentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplenishmentDraftItem" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "productName" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "currentStock" DECIMAL(65,30) NOT NULL,
    "salesLast30Days" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "salesLast60Days" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "salesLast90Days" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lastSoldAt" TIMESTAMP(3),
    "criticality" "ReplenishmentDraftCriticality" NOT NULL,
    "recommendedSource" "ReplenishmentDraftSource" NOT NULL,
    "sourceBranchId" TEXT,
    "suggestedQuantity" DECIMAL(65,30) NOT NULL,
    "finalQuantity" DECIMAL(65,30),
    "reason" TEXT NOT NULL,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "requiresManualReview" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReplenishmentDraftItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "linkedTransferId" TEXT,
    "linkedPurchaseOrderId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplenishmentDraftItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReplenishmentDraft_branchId_status_idx" ON "ReplenishmentDraft"("branchId", "status");

-- CreateIndex
CREATE INDEX "ReplenishmentDraft_createdAt_idx" ON "ReplenishmentDraft"("createdAt");

-- CreateIndex
CREATE INDEX "ReplenishmentDraft_createdByUserId_idx" ON "ReplenishmentDraft"("createdByUserId");

-- CreateIndex
CREATE INDEX "ReplenishmentDraftItem_draftId_idx" ON "ReplenishmentDraftItem"("draftId");

-- CreateIndex
CREATE INDEX "ReplenishmentDraftItem_productId_branchId_idx" ON "ReplenishmentDraftItem"("productId", "branchId");

-- CreateIndex
CREATE INDEX "ReplenishmentDraftItem_status_idx" ON "ReplenishmentDraftItem"("status");

-- AddForeignKey
ALTER TABLE "ReplenishmentDraft" ADD CONSTRAINT "ReplenishmentDraft_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentDraft" ADD CONSTRAINT "ReplenishmentDraft_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentDraft" ADD CONSTRAINT "ReplenishmentDraft_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentDraftItem" ADD CONSTRAINT "ReplenishmentDraftItem_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ReplenishmentDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentDraftItem" ADD CONSTRAINT "ReplenishmentDraftItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentDraftItem" ADD CONSTRAINT "ReplenishmentDraftItem_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
