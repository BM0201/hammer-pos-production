-- prompt-gastos-semana-quincena.md Fase 4 — revisión de CASH_OUT genérico:
-- Master puede marcar un retiro "No es gasto" (reviewedAt/reviewNote, mismo
-- nombrado que CashSession/OperationalDay) sin tocar su `type` ni su monto.
-- Clasificarlo como gasto real (sí es un gasto) se hace aparte, en código:
-- cambia `type` a EXPENSE_OUT y liga un OperatingExpense — no requiere estas
-- columnas, por eso no hay una columna "classifiedAt" acá.

ALTER TABLE "CashMovement" ADD COLUMN "reviewedByUserId" TEXT;
ALTER TABLE "CashMovement" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "CashMovement" ADD COLUMN "reviewNote" TEXT;

ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CashMovement_type_reviewedAt_createdAt_idx" ON "CashMovement"("type", "reviewedAt", "createdAt");
