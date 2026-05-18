-- Phase 2-6: Schema updates for corrected business flows
-- PurchaseOrder: add approval/receipt tracking fields
ALTER TABLE "PurchaseOrder" ADD COLUMN "approvedByUserId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN "receivedByUserId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "receivedAt" TIMESTAMP(3);

-- Transfer: add dispatch/receive user tracking fields
ALTER TABLE "Transfer" ADD COLUMN "dispatchedByUserId" TEXT;
ALTER TABLE "Transfer" ADD COLUMN "receivedByUserId" TEXT;

-- TransportService: unique constraint per saleOrderId (anti-duplicate)
-- Drop existing index if present, then create unique constraint
DROP INDEX IF EXISTS "TransportService_saleOrderId_idx";
CREATE UNIQUE INDEX "TransportService_saleOrderId_key" ON "TransportService"("saleOrderId");
