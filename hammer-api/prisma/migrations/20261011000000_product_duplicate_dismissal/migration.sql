-- prompt-codigos-y-duplicados.md Fase 4 — pantalla de posibles duplicados.
-- Aditiva: ninguna tabla existente pierde filas ni columnas.

-- CreateTable
CREATE TABLE "ProductDuplicateDismissal" (
    "id" TEXT NOT NULL,
    "productAId" TEXT NOT NULL,
    "productBId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "dismissedByUserId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "ProductDuplicateDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductDuplicateDismissal_pairKey_key" ON "ProductDuplicateDismissal"("pairKey");

-- AddForeignKey
ALTER TABLE "ProductDuplicateDismissal" ADD CONSTRAINT "ProductDuplicateDismissal_productAId_fkey" FOREIGN KEY ("productAId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductDuplicateDismissal" ADD CONSTRAINT "ProductDuplicateDismissal_productBId_fkey" FOREIGN KEY ("productBId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductDuplicateDismissal" ADD CONSTRAINT "ProductDuplicateDismissal_dismissedByUserId_fkey" FOREIGN KEY ("dismissedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
