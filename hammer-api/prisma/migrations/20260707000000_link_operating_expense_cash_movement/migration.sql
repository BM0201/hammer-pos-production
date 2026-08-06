-- Vincula OperatingExpense (gasto/presupuesto) con el CashMovement (egreso real de caja)
-- que se genera cuando el gasto se paga efectivamente desde una caja abierta.
-- Antes: OperatingExpense solo alimentaba el "presupuesto" y nunca contaba como
-- "gasto real pagado" (el % ejecutado quedaba siempre en 0%). Con esta FK, un gasto
-- del local genera su egreso de caja y se refleja en el desempeño real.

-- AlterTable
ALTER TABLE "OperatingExpense" ADD COLUMN "cashMovementId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OperatingExpense_cashMovementId_key" ON "OperatingExpense"("cashMovementId");

-- CreateIndex
CREATE INDEX "OperatingExpense_cashMovementId_idx" ON "OperatingExpense"("cashMovementId");

-- AddForeignKey
ALTER TABLE "OperatingExpense" ADD CONSTRAINT "OperatingExpense_cashMovementId_fkey" FOREIGN KEY ("cashMovementId") REFERENCES "CashMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
