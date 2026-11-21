-- Cobro en dólares: el tender CASH guarda cuántos US$ entregó el cliente y la
-- tasa usada (receivedAmount queda en C$ = US$ × tasa; el vuelto sale en C$).
-- La caja guarda cuántos US$ debía haber al cerrar, para compararlos contra
-- countedUsdAmount. 100% aditivo y nullable.

-- AlterTable
ALTER TABLE "PaymentTender" ADD COLUMN "receivedUsdAmount" DECIMAL(14,2),
ADD COLUMN "usdRate" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN "expectedUsdAmount" DECIMAL(14,2);
