-- Tesorería (correccion-destino-y-pantalla-cobro.md): cuentas bancarias
-- (Master-only, varias, opcionalmente por sucursal), depósitos confirmados,
-- y la declaración de destino del efectivo al cerrar caja (los tres
-- destinos son la misma pregunta — §1). Branch.cashFundAmount es el fondo
-- de caja (lo que la sesión debería poder abrir al día siguiente, §1.1) —
-- nullable a propósito: sin configurar, todo lo retenido cuenta como
-- esperando depósito (conservador y correcto).

-- CreateEnum
CREATE TYPE "RetainedCashLocation" AS ENUM ('DRAWER', 'SAFE');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN "cashFundAmount" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "PaymentTender" ADD COLUMN "bankAccountId" TEXT;

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountAlias" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NIO',
    "branchId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankDeposit" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "depositedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedByUserId" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashDestinationDeclaration" (
    "id" TEXT NOT NULL,
    "cashSessionId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "declaredByUserId" TEXT NOT NULL,
    "handOverAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "handOverUserId" TEXT,
    "depositAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "depositCarrierUserId" TEXT,
    "depositBankAccountId" TEXT,
    "retainAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "retainCashFundPortion" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "retainAwaitingDepositPortion" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "awaitingDepositLocation" "RetainedCashLocation" NOT NULL DEFAULT 'DRAWER',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashDestinationDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankAccount_branchId_isActive_idx" ON "BankAccount"("branchId", "isActive");

-- CreateIndex
CREATE INDEX "BankDeposit_branchId_depositedAt_idx" ON "BankDeposit"("branchId", "depositedAt");

-- CreateIndex
CREATE INDEX "BankDeposit_bankAccountId_depositedAt_idx" ON "BankDeposit"("bankAccountId", "depositedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CashDestinationDeclaration_cashSessionId_key" ON "CashDestinationDeclaration"("cashSessionId");

-- CreateIndex
CREATE INDEX "CashDestinationDeclaration_branchId_createdAt_idx" ON "CashDestinationDeclaration"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentTender_bankAccountId_idx" ON "PaymentTender"("bankAccountId");

-- AddForeignKey
ALTER TABLE "PaymentTender" ADD CONSTRAINT "PaymentTender_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDeposit" ADD CONSTRAINT "BankDeposit_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDeposit" ADD CONSTRAINT "BankDeposit_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDeposit" ADD CONSTRAINT "BankDeposit_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDestinationDeclaration" ADD CONSTRAINT "CashDestinationDeclaration_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDestinationDeclaration" ADD CONSTRAINT "CashDestinationDeclaration_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDestinationDeclaration" ADD CONSTRAINT "CashDestinationDeclaration_declaredByUserId_fkey" FOREIGN KEY ("declaredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDestinationDeclaration" ADD CONSTRAINT "CashDestinationDeclaration_handOverUserId_fkey" FOREIGN KEY ("handOverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDestinationDeclaration" ADD CONSTRAINT "CashDestinationDeclaration_depositCarrierUserId_fkey" FOREIGN KEY ("depositCarrierUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDestinationDeclaration" ADD CONSTRAINT "CashDestinationDeclaration_depositBankAccountId_fkey" FOREIGN KEY ("depositBankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
