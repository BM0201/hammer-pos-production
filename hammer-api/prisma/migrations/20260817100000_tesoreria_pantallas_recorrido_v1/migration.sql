-- prompt-pantallas-recorrido-dinero.md: campos que faltaban para las 4
-- pantallas del recorrido del dinero. owner/acceptsCustomerPayments/
-- lastUsedAt en BankAccount (§1.3 — selector de cuenta con titular, filtro
-- de cuentas de cobro, orden por uso). isAutoDefaulted en
-- CashDestinationDeclaration (§3 — cierre automático por cron).

-- AlterTable
ALTER TABLE "BankAccount" ADD COLUMN "owner" TEXT;
ALTER TABLE "BankAccount" ADD COLUMN "acceptsCustomerPayments" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BankAccount" ADD COLUMN "lastUsedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CashDestinationDeclaration" ADD COLUMN "isAutoDefaulted" BOOLEAN NOT NULL DEFAULT false;
