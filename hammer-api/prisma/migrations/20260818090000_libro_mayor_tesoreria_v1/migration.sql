-- prompt-libro-mayor-tesoreria.md: TreasuryAccount reemplaza a BankAccount
-- (una cuenta bancaria y un bolsillo de custodia son la misma clase de
-- cosa: un lugar donde el dinero puede estar, con su propio saldo), y
-- TreasuryEntry es el libro mayor de partida doble. El saldo nunca se
-- guarda editable — se calcula sumando estas filas (openingBalance + IN -
-- OUT). Los FK/índices existentes sobre la tabla renombrada se conservan
-- (Postgres los sigue por OID, no por nombre); solo quedan con el nombre
-- legado "BankAccount_*" en vez de "TreasuryAccount_*" — cosmético, no
-- afecta su funcionamiento.

-- CreateEnum
CREATE TYPE "TreasuryAccountType" AS ENUM ('BANK', 'SETTLEMENT', 'CUSTODY', 'SAFE');
CREATE TYPE "TreasuryEntryDirection" AS ENUM ('IN', 'OUT');
CREATE TYPE "TreasuryEntryType" AS ENUM ('SALE_TRANSFER', 'SALE_CARD', 'CARD_SETTLEMENT', 'CARD_FEE', 'DEPOSIT_DISPATCH', 'HANDOVER', 'RETAIN_TO_SAFE', 'DEPOSIT_CONFIRMED', 'SUPPLIER_PAYMENT', 'PAYROLL', 'EXPENSE', 'CUSTOMER_ADVANCE', 'RECONCILIATION');
CREATE TYPE "TreasuryCounterpartyType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'ACQUIRER', 'INTERNAL', 'ADJUSTMENT');

-- RenameTable
ALTER TABLE "BankAccount" RENAME TO "TreasuryAccount";

-- AlterTable: nuevos campos
ALTER TABLE "TreasuryAccount" ADD COLUMN "type" "TreasuryAccountType" NOT NULL DEFAULT 'BANK';
ALTER TABLE "TreasuryAccount" ADD COLUMN "code" TEXT;
ALTER TABLE "TreasuryAccount" ADD COLUMN "holderUserId" TEXT;
ALTER TABLE "TreasuryAccount" ADD COLUMN "openingBalance" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "TreasuryAccount" ADD COLUMN "openingBalanceAt" TIMESTAMP(3);

-- AlterTable: currency (texto libre) -> currencyCode (enum). Las cuentas
-- existentes solo tenían 'NIO'/'USD', el cast es exacto y sin pérdida.
ALTER TABLE "TreasuryAccount" ADD COLUMN "currencyCode" "CurrencyCode" NOT NULL DEFAULT 'NIO';
UPDATE "TreasuryAccount" SET "currencyCode" = "currency"::"CurrencyCode";
ALTER TABLE "TreasuryAccount" DROP COLUMN "currency";

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryAccount_code_key" ON "TreasuryAccount"("code");
CREATE INDEX "TreasuryAccount_type_isActive_idx" ON "TreasuryAccount"("type", "isActive");
CREATE INDEX "TreasuryAccount_holderUserId_idx" ON "TreasuryAccount"("holderUserId");

-- AddForeignKey
ALTER TABLE "TreasuryAccount" ADD CONSTRAINT "TreasuryAccount_holderUserId_fkey" FOREIGN KEY ("holderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "TreasuryEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "direction" "TreasuryEntryDirection" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currencyCode" "CurrencyCode" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transferId" TEXT,
    "entryType" "TreasuryEntryType" NOT NULL,
    "counterpartyType" "TreasuryCounterpartyType" NOT NULL,
    "counterpartyName" TEXT,
    "cashMovementId" TEXT,
    "paymentTenderId" TEXT,
    "bankDepositId" TEXT,
    "expensePaymentId" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "TreasuryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryEntry_cashMovementId_key" ON "TreasuryEntry"("cashMovementId");
CREATE UNIQUE INDEX "TreasuryEntry_paymentTenderId_key" ON "TreasuryEntry"("paymentTenderId");
CREATE UNIQUE INDEX "TreasuryEntry_expensePaymentId_key" ON "TreasuryEntry"("expensePaymentId");
CREATE INDEX "TreasuryEntry_accountId_occurredAt_createdAt_idx" ON "TreasuryEntry"("accountId", "occurredAt", "createdAt");
CREATE INDEX "TreasuryEntry_transferId_idx" ON "TreasuryEntry"("transferId");
CREATE INDEX "TreasuryEntry_entryType_occurredAt_idx" ON "TreasuryEntry"("entryType", "occurredAt");

-- AddForeignKey
ALTER TABLE "TreasuryEntry" ADD CONSTRAINT "TreasuryEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TreasuryEntry" ADD CONSTRAINT "TreasuryEntry_cashMovementId_fkey" FOREIGN KEY ("cashMovementId") REFERENCES "CashMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TreasuryEntry" ADD CONSTRAINT "TreasuryEntry_paymentTenderId_fkey" FOREIGN KEY ("paymentTenderId") REFERENCES "PaymentTender"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TreasuryEntry" ADD CONSTRAINT "TreasuryEntry_bankDepositId_fkey" FOREIGN KEY ("bankDepositId") REFERENCES "BankDeposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TreasuryEntry" ADD CONSTRAINT "TreasuryEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "fromCurrency" "CurrencyCode" NOT NULL,
    "toCurrency" "CurrencyCode" NOT NULL,
    "rate" DECIMAL(65,30) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExchangeRate_fromCurrency_toCurrency_effectiveAt_idx" ON "ExchangeRate"("fromCurrency", "toCurrency", "effectiveAt");

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
