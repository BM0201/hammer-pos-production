-- Consistencia del resumen del día operativo:
-- 1) CORRECTION_OUT: corrección que RESTA de la gaveta (CORRECTION legado
--    queda como entrada, por compatibilidad con datos existentes).
-- 2) SaleOrder.cancelledAt: momento real de la anulación. NULL en datos
--    legacy (el resumen cae a updatedAt como fallback).

-- AlterEnum
ALTER TYPE "CashMovementType" ADD VALUE 'CORRECTION_OUT';

-- AlterTable
ALTER TABLE "SaleOrder" ADD COLUMN "cancelledAt" TIMESTAMP(3);
