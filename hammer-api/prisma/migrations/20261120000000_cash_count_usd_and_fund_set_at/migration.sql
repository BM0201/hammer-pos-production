-- Conteo de cierre: los dólares se anotan aparte (no suman al contado en
-- córdobas), con la tasa que se usó para mostrar "equivale a".
-- Sencillo fijado por Master: fecha para saber si manda sobre el último cierre.
-- 100% aditivo y nullable: nada existente cambia.

-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN "countedUsdAmount" DECIMAL(14,2),
ADD COLUMN "countedUsdRate" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN "cashFundSetAt" TIMESTAMP(3);
