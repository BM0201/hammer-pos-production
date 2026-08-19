-- Tesorería: tarjetas ligadas a cuentas + rastro de tarjeta en pagos
-- salientes del libro mayor.
--   * TreasuryCard: una o varias tarjetas (débito/crédito) por cuenta, para
--     pagar proveedores/gastos DESDE esa cuenta y que baje su saldo.
--   * TreasuryEntry.cardId: en un pago OUT hecho con tarjeta, deja el rastro
--     de "con qué tarjeta se pagó".
-- No se persiste el número completo — solo los últimos 4 y datos descriptivos.

-- CreateEnum
CREATE TYPE "TreasuryCardType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "TreasuryCard" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "brand" TEXT,
    "last4" TEXT,
    "cardType" "TreasuryCardType" NOT NULL DEFAULT 'DEBIT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreasuryCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TreasuryCard_accountId_isActive_idx" ON "TreasuryCard"("accountId", "isActive");

-- AlterTable
ALTER TABLE "TreasuryEntry" ADD COLUMN "cardId" TEXT;

-- CreateIndex
CREATE INDEX "TreasuryEntry_cardId_idx" ON "TreasuryEntry"("cardId");

-- AddForeignKey
ALTER TABLE "TreasuryCard" ADD CONSTRAINT "TreasuryCard_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryEntry" ADD CONSTRAINT "TreasuryEntry_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "TreasuryCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
