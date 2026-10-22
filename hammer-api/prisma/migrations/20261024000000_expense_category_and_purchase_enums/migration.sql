-- prompt-caja-gastos-pos-cobro.md Commit 1 — valores de enum nuevos en su
-- propia migración (separados de la tabla CashPurchase que los usa).
-- Generada SIN conexión a ninguna base (prisma migrate diff
-- --from-schema-datamodel <antes> --to-schema-datamodel <después>).
-- 100% aditivo: solo agrega valores a enums existentes.

-- AlterEnum
ALTER TYPE "CashMovementType" ADD VALUE 'PURCHASE_OUT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExpenseCategory" ADD VALUE 'SUPPLIES';
ALTER TYPE "ExpenseCategory" ADD VALUE 'CASUAL_LABOR';
ALTER TYPE "ExpenseCategory" ADD VALUE 'BANK_FEES';

