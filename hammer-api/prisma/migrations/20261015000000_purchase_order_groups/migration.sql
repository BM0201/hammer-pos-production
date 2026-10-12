-- Parte B.1 (prompt-completo-pendientes-2026-10.md) — pedido multisucursal:
-- una carga produce N PurchaseOrder (una por sucursal), agrupadas por
-- PurchaseOrderGroup. OrderTemplate es compartida por B.1/B.2/B.3 ("lo que
-- se pide siempre").

CREATE TYPE "OrderTemplateKind" AS ENUM ('PURCHASE', 'INTAKE', 'TRANSFER');

CREATE TABLE "PurchaseOrderGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "supplierId" TEXT,
    "expectedDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrderGroup_code_key" ON "PurchaseOrderGroup"("code");
CREATE UNIQUE INDEX "PurchaseOrderGroup_sequence_key" ON "PurchaseOrderGroup"("sequence");
CREATE UNIQUE INDEX "PurchaseOrderGroup_clientRequestId_key" ON "PurchaseOrderGroup"("clientRequestId");

ALTER TABLE "PurchaseOrderGroup" ADD CONSTRAINT "PurchaseOrderGroup_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderGroup" ADD CONSTRAINT "PurchaseOrderGroup_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrder" ADD COLUMN "groupId" TEXT;
CREATE INDEX "PurchaseOrder_groupId_idx" ON "PurchaseOrder"("groupId");
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "PurchaseOrderGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "OrderTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "OrderTemplateKind" NOT NULL,
    "supplierId" TEXT,
    "branchIds" TEXT[],
    "linesJson" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderTemplate_kind_isActive_idx" ON "OrderTemplate"("kind", "isActive");

ALTER TABLE "OrderTemplate" ADD CONSTRAINT "OrderTemplate_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderTemplate" ADD CONSTRAINT "OrderTemplate_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
